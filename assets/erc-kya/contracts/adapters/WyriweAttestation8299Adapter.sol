// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.24;

import {IKYATypes} from "../interfaces/IKYATypes.sol";
import {IKYARegistry} from "../interfaces/IKYARegistry.sol";

/// @title ERC-8299 (WYRIWE) → ERC-KYA issuing adapter (composition adapter; kept out of the ERC assets)
/// @notice Turns a signed WYRIWE input-provenance attestation (ERC-8299) into a KYA assertion
///         through the EXISTING `ATTESTED` path. The adapter is the `msg.sender` of `attest()`,
///         so the adapter is the recorded issuer, not the attesting gateway. No new admission
///         mode, and nothing in the KYA normative core needs to know ERC-8299 exists.
///
/// WHY an adapter, and not a WYRIWE-specific mode in the core. ERC-8299 standardises an
/// EIP-712 signed commitment to an inference's inputs (`raw_input_hash`,
/// `sanitization_pipeline_hash`, `input_hash`). KYA records WHAT was concluded about a subject.
/// The adapter is the seam: it verifies the attestation's signature against one pinned attestor,
/// binds it to the asserted ERC-8004 subject, and records a conclusion the scheme defines.
///
/// WHAT this adapter concludes, and what it does NOT (scheme-authoring-notes.md §2). A WYRIWE
/// attestation, on its own, supports the PROVENANCE-COMMITTED conclusion: "the inputs to this
/// pipeline were committed and are recomputable." It does NOT support CONSUMPTION-BOUND ("this
/// exact input was consumed by this invocation"): nothing here binds the input commitment to a
/// particular run. A scheme wanting the stronger conclusion names its binding artifact in the
/// descriptor's `evidenceKinds` and uses a different adapter. This adapter issues the weaker,
/// honest one and says so.
///
/// WHAT GRADE OF EVIDENCE THIS IS. On-chain, the adapter verifies ERC-8299 §5 step 1 (the
/// EIP-712 signature recovers to the pinned attestor) and binds the attestation to the subject.
/// It does NOT perform §5 steps 2-4 — recomputing `raw_input_hash` or applying the sanitization
/// spec at `sanitization_spec_cid` to re-derive `input_hash`. Those need the raw input and the
/// off-chain spec, and are the relying party's recomputation. So a recorded assertion means "the
/// pinned attestor signed this input-provenance commitment for this agent", which is exactly
/// provenance-committed; the pipeline's correctness is checked off-chain against the committed
/// hashes, trustlessly, by whoever relies on it. Named rather than implied, so the conclusion is
/// not read as stronger than its evidence.
///
/// ONE ADAPTER, ONE SCHEME, ONE ATTESTOR. The scheme is pinned at construction; its level is the
/// scheme's, checked against the committed result domain. Unlike a validation-network score there
/// is no ladder to map: a provenance commitment is not graded. The attestation verifies and the
/// scheme's provenance-committed level is recorded, or it does not and NOTHING is recorded. Which
/// preserves the line the ERC-8294 adapter is also built around:
///
///     an OPERATIONAL FAILURE IS NOT A NEGATIVE TRUST CONCLUSION.
///
/// A missing, malformed or wrongly-signed attestation has told us nothing about the agent.
/// Recording that as `level = 0` would publish a durable negative conclusion no attestor reached.
/// This adapter reverts in that case rather than attesting a floor value. Unlike the 8294 case
/// there is no "completed negative" here at all: a provenance commitment either verifies or its
/// evidence is absent, so level 0 is never issued by this adapter.
contract WyriweAttestation8299Adapter {
    /// @dev The WYRIWE attestation surface, ERC-8299 §3. Field order is normative (it fixes the
    ///      EIP-712 type hash below); do not reorder.
    struct WyriweAttestation {
        bytes32 agentId;                  // ERC-8004 identity anchor, bytes32(uint256(registryId))
        address registry;                 // ERC-8004 registry address
        bytes32 modelHash;                // hash of model weights/manifest (what model ran)
        bytes32 rawInputHash;             // keccak256(raw_user_input)
        bytes32 sanitizationPipelineHash; // keccak256(sanitization_spec_cid_bytes || raw_input_hash)
        bytes32 inputHash;                // keccak256(sanitized_input)
        bytes32 outputHash;               // keccak256(model_output)
        uint256 timestamp;                // unix timestamp of execution
    }

    /// @dev EIP-712 type hash for WyriweAttestation. The type string is the normative one from
    ///      ERC-8299 §3, field order included; any other order is a different scheme and MUST NOT verify.
    bytes32 private constant WYRIWE_TYPEHASH = keccak256(
        "WyriweAttestation(bytes32 agentId,address registry,bytes32 modelHash,bytes32 rawInputHash,bytes32 sanitizationPipelineHash,bytes32 inputHash,bytes32 outputHash,uint256 timestamp)"
    );
    /// @dev EIP-712 domain (ERC-8299 §4): name, version and chainId ONLY — no verifyingContract.
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 private constant WYRIWE_DOMAIN_NAME = keccak256(bytes("ERC8004AttestationGateway"));
    bytes32 private constant WYRIWE_DOMAIN_VERSION = keccak256(bytes("1"));

    uint8 private constant ORDERED_LEVEL = uint8(IKYATypes.ResultKind.ORDERED_LEVEL);
    bytes32 private constant SUBJECT_TYPE_ERC8004 = keccak256("erc8004");
    /// @dev secp256k1n/2; signatures with s above this are malleable (EIP-2) and are rejected.
    uint256 private constant SECP256K1_HALF_N =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    IKYARegistry public immutable kya;

    /// @dev The one scheme this adapter issues under, pinned so its level can be checked against
    ///      the scheme's committed result domain once, at construction.
    bytes32 public immutable schemeId;

    /// @dev The provenance-committed level this adapter records. A FIXED positive level, declared
    ///      by the scheme (checked against `resultDomain` in the constructor), never level 0: a
    ///      provenance commitment that verifies is a positive conclusion, and one that does not is
    ///      an operational failure that leaves no assertion. Level semantics stay with the scheme.
    uint8 public immutable issuedLevel;

    /// @dev The one WYRIWE attestor (gateway signer) this adapter accepts, pinned. A relying party
    ///      reading an assertion issued by this address is trusting exactly this signer; moving it
    ///      would need a new adapter instance, which is the point.
    address public immutable attestor;

    /// @dev The ERC-8004 identity registry and chain this adapter's subjects live on. Pinned so an
    ///      attestation cannot be re-pointed at a subject on another registry or chain.
    uint256 public immutable subjectChainId;
    address public immutable identityRegistry;

    /// @notice The signature did not recover to the attestor this adapter pins. Also the resting
    ///         place of a signature with a bad `v` or a garbage (r,s): it recovers to the zero or
    ///         a wrong address, which is not the attestor.
    error BadAttestor(address recovered, address expected);
    /// @notice The signature is the wrong length or malleable (high-s). An operational failure,
    ///         NOT a negative conclusion about the agent.
    error MalformedSignature();
    /// @notice Constructed with the zero address as attestor, which would accept any signature
    ///         that recovers to zero (an invalid one). Refused at construction.
    error InvalidAttestor();
    /// @notice The attestation is about a different agent than the asserted subject.
    error SubjectMismatch(bytes32 reported, bytes32 asserted);
    /// @notice The subject is not an `erc8004` subject, names another chain/registry, or the
    ///         attestation names a registry other than the one this adapter is pinned to.
    error UnsupportedSubject();
    /// @notice The scheme is not ordered-level, so a conclusion cannot be recorded under it.
    error SchemeNotOrdered(bytes32 schemeId, uint8 resultKind);
    /// @notice The level this adapter would issue is 0, or is not declared in the scheme's
    ///         committed mask. Keyed off the SAME `resultDomain` value the registry enforces.
    error LevelNotDeclared(bytes32 schemeId, uint256 levelMask, uint8 level);

    event AssertionIssuedFromAttestation(
        bytes32 indexed assertionId,
        bytes32 indexed inputHash,
        address attestor,
        bytes32 agentId,
        uint8 level
    );

    constructor(
        address kya_,
        bytes32 schemeId_,
        uint8 issuedLevel_,
        address attestor_,
        uint256 subjectChainId_,
        address identityRegistry_
    ) {
        // The attestor is the one key this adapter trusts; the zero address would make any
        // signature that recovers to zero (an invalid one) pass the attestor check, so it is
        // refused here rather than relying on every call to notice.
        if (attestor_ == address(0)) revert InvalidAttestor();

        kya = IKYARegistry(kya_);
        schemeId = schemeId_;
        issuedLevel = issuedLevel_;
        attestor = attestor_;
        subjectChainId = subjectChainId_;
        identityRegistry = identityRegistry_;

        // The level is the scheme's: ordered-level kind, the issued level declared in the committed
        // mask, and never level 0 (a provenance-committed conclusion is positive). Read from the one
        // value the KYA registry also enforces, `resultDomain(schemeId).levelMask`, so the adapter
        // and the registry cannot drift into one admitting a level the other denies.
        (uint8 kind, uint256 levelMask) = IKYARegistry(kya_).resultDomain(schemeId_);
        if (kind != ORDERED_LEVEL) revert SchemeNotOrdered(schemeId_, kind);
        if (issuedLevel_ == 0 || ((levelMask >> issuedLevel_) & 1) == 0) {
            revert LevelNotDeclared(schemeId_, levelMask, issuedLevel_);
        }
    }

    /// @notice The EIP-712 domain separator for WYRIWE attestations on THIS chain (ERC-8299 §4).
    /// @dev Built from `block.chainid`, so an attestation signed under another chain's domain does
    ///      not verify here — the replay protection ERC-8299 §4 requires.
    function _domainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, WYRIWE_DOMAIN_NAME, WYRIWE_DOMAIN_VERSION, block.chainid)
        );
    }

    function _digest(WyriweAttestation calldata att) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                WYRIWE_TYPEHASH,
                att.agentId,
                att.registry,
                att.modelHash,
                att.rawInputHash,
                att.sanitizationPipelineHash,
                att.inputHash,
                att.outputHash,
                att.timestamp
            )
        );
        return keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
    }

    /// @dev EIP-712 §5 step 1: recover the signer with EIP-2 low-s and valid-v enforcement.
    ///      Strict by design — a malleable or malformed signature establishes nothing and must
    ///      not be mapped onto any conclusion.
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert MalformedSignature();
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        // EIP-2: reject the high-s half, so a valid signature cannot be reshaped into a second
        // accepted one. A bad `v`, or an (r,s) that recovers to the zero or a wrong address, needs
        // no separate guard here: ecrecover returns the zero address for an invalid `v`, and the
        // caller's attestor check refuses anything that is not the pinned attestor (never zero).
        if (uint256(s) > SECP256K1_HALF_N) revert MalformedSignature();
        return ecrecover(digest, v, r, s);
    }

    /// @dev The subject must be the `erc8004` subject on the chain and identity registry this
    ///      adapter is pinned to, so an attestation cannot be re-pointed at a subject elsewhere.
    function _subjectAgentId(IKYATypes.Subject calldata subject) private view returns (bytes32) {
        if (subject.subjectType != SUBJECT_TYPE_ERC8004) revert UnsupportedSubject();
        (uint256 chainId_, address identity_, uint256 agentId_) =
            abi.decode(subject.subjectData, (uint256, address, uint256));
        if (chainId_ != subjectChainId || identity_ != identityRegistry) revert UnsupportedSubject();
        return bytes32(agentId_);
    }

    /// @notice Issue a KYA provenance-committed assertion from a signed WYRIWE attestation, under
    ///         the scheme this adapter is bound to. Reverts rather than issuing when the signature,
    ///         attestor or subject binding do not hold; the recorded issuer is this adapter.
    /// @dev `claimDigest` commits the attestation's binding hashes. They are themselves hash
    ///      commitments (ERC-8299 §3) with full 256-bit entropy, so committing over them satisfies
    ///      the entropy requirement without a separate salt (scheme-authoring-notes §4).
    function issueFromAttestation(
        IKYATypes.Subject calldata subject,
        WyriweAttestation calldata att,
        bytes calldata signature,
        uint64 expiresAt,
        string calldata evidenceURI
    ) external returns (bytes32 assertionId) {
        address signer = _recover(_digest(att), signature);
        if (signer != attestor) revert BadAttestor(signer, attestor);

        // The attestation must be about the agent the subject names, on the registry this adapter
        // is pinned to. agentId drives SubjectMismatch; a foreign registry is an UnsupportedSubject.
        bytes32 subjectAgentId = _subjectAgentId(subject);
        if (att.agentId != subjectAgentId) revert SubjectMismatch(att.agentId, subjectAgentId);
        if (att.registry != identityRegistry) revert UnsupportedSubject();

        // The two hashes are each built in their own frame (the helpers below), then held as two
        // locals across the seven-argument `attest` call — the ERC-8294 adapter holds four the same
        // way. `signer` and `subjectAgentId` have had their last use above, so they are off the
        // stack here; inlining the builders as call arguments instead would push the call over the
        // stack limit under the repo's settings (optimizer on, no viaIR).
        bytes32 claimDigest = _claimDigest(att);
        bytes32 evidenceHash = _evidenceHash(att, signer);
        assertionId = kya.attest(subject, schemeId, issuedLevel, claimDigest, expiresAt, evidenceURI, evidenceHash);
        emit AssertionIssuedFromAttestation(assertionId, att.inputHash, attestor, att.agentId, issuedLevel);
    }

    /// @dev claimDigest over the attestation's binding hashes (ERC-8299 §3). Each is a 256-bit
    ///      commitment, so committing over them carries the entropy Section 4 of the KYA spec asks
    ///      for without a separate salt (scheme-authoring-notes §4).
    function _claimDigest(WyriweAttestation calldata att) private pure returns (bytes32) {
        return keccak256(
            abi.encode(att.rawInputHash, att.sanitizationPipelineHash, att.inputHash, att.outputHash, att.modelHash)
        );
    }

    /// @dev Source provenance, retained: the RECOVERED signer (what was verified, not a reused
    ///      constant) and every committed field, so the conclusion is re-derivable and the
    ///      commitment names the attestor that produced it. A collapsed value must not hide which
    ///      state produced it.
    function _evidenceHash(WyriweAttestation calldata att, address signer) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "wyriwe-attestation",
                signer,
                att.agentId,
                att.registry,
                att.modelHash,
                att.rawInputHash,
                att.sanitizationPipelineHash,
                att.inputHash,
                att.outputHash,
                att.timestamp
            )
        );
    }
}
