// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.24;

import {IKYATypes} from "../interfaces/IKYATypes.sol";
import {IKYARegistry} from "../interfaces/IKYARegistry.sol";

/// @notice Minimal ERC-8294 surface this adapter depends on. ERC-8294 extends ERC-8004's
///         Validation Registry so a `validatorAddress` may be a NETWORK of independent
///         validators rather than a single party.
interface IValidationNetwork8294 {
    /// @return state 0=unknown, 1=pending, 2=responded, 3=failed
    /// @return validatorCount number of validators selected
    /// @return responseAggregated whether validationResponse() has been written
    function status(bytes32 requestHash)
        external
        view
        returns (uint8 state, uint16 validatorCount, bool responseAggregated);

    /// @dev A stable identifier for the verification semantics the network implements.
    function verificationProfile() external view returns (bytes32);
}

interface IERC8004ValidationStatus {
    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (
            address validatorAddress,
            uint256 agentId,
            uint8 response,
            bytes32 responseHash,
            string memory tag,
            uint256 lastUpdate
        );
}

/// @title ERC-8294 → ERC-KYA issuing adapter
/// @notice Turns an ERC-8294 validation-network result into a KYA assertion through the
///         EXISTING `ATTESTED` path. The adapter is the `msg.sender` of `attest()`, so the
///         adapter is the recorded issuer — not the individual validators, and not the
///         network. No new admission mode, and nothing in the KYA normative core needs to
///         know that ERC-8294 exists.
///
/// Why an adapter rather than treating a network as a drop-in issuer: ERC-8294 standardises
/// WHO validated (selection, operator diversity, aggregation). KYA records WHAT was
/// concluded. The quorum and operator-diversity requirements of the selection policy are
/// enforced HERE, because a KYA `rule.issuers[]` is an accepted-issuer set and not a native
/// quorum check. A relying party that trusts this adapter is trusting exactly that
/// enforcement, which is why `requiredValidators` is immutable and the profile is pinned.
///
/// The distinction this adapter exists to preserve:
///
///     an OPERATIONAL FAILURE IS NOT A NEGATIVE TRUST CONCLUSION.
///
/// A network that timed out, is still pending, or returned fewer validators than the policy
/// required has told us NOTHING about the agent. Recording that as `level = 0` would publish
/// a durable negative conclusion that no validator ever reached — the verdict says "checked
/// and found wanting" where the truth is "could not be checked". This adapter refuses to
/// attest in that case rather than attesting a floor value.
contract ValidationNetwork8294Adapter {
    /// @dev ERC-8294 request states.
    uint8 private constant STATE_RESPONDED = 2;

    IKYARegistry public immutable kya;
    IERC8004ValidationStatus public immutable validationRegistry;
    IValidationNetwork8294 public immutable network;

    /// @dev The ERC-8004 identity registry and chain this adapter's subjects live on. Pinned so
    ///      a result cannot be re-pointed at a subject on a different registry.
    uint256 public immutable subjectChainId;
    address public immutable identityRegistry;

    /// @dev Minimum selected validators, mirroring the selection policy's `selectionSize` (N).
    ///      Immutable: a relying party reading an assertion issued by this address is relying on
    ///      this number not having moved.
    ///
    ///      ⚠ THIS IS A COUNT, NOT OPERATOR DIVERSITY. ERC-8294's selection policy also carries
    ///      `minOperators` (D) — the minimum number of DISTINCT operators across the selected
    ///      set — and that is the parameter that actually resists collusion. `status()` reports
    ///      only `validatorCount`, so operator diversity is NOT observable through the
    ///      interface this adapter reads and is therefore NOT enforced here: it remains the
    ///      network's responsibility under its own policy. Seven validators operated by one
    ///      party satisfy this floor. A relying party that needs D must establish it from the
    ///      network's selection policy and `ValidatorsSelected` events, not from this
    ///      assertion. Named rather than quietly conflated, because one field standing for two
    ///      different guarantees is how the weaker one gets presented as the stronger.
    uint16 public immutable requiredValidators;

    /// @dev The network verification profile this adapter accepts, pinned at construction.
    bytes32 public immutable expectedProfile;

    bytes32 private constant SUBJECT_TYPE_ERC8004 = keccak256("erc8004");

    /// @notice The request completed but reported a different network than this adapter trusts.
    error NotExpectedNetwork(address reported, address expected);
    /// @notice The validation result is about a different agent than the asserted subject.
    error SubjectMismatch(uint256 reported, uint256 asserted);
    /// @notice The subject is not an `erc8004` subject, or names another chain/registry.
    error UnsupportedSubject();
    /// @notice The run did not complete. NOT a negative conclusion about the agent — see the
    ///         contract notice. `state` is the ERC-8294 request state.
    error ResultNotEstablished(bytes32 requestHash, uint8 state, bool responseAggregated);
    /// @notice Fewer validators than the policy floor. Also not a conclusion about the agent.
    error QuorumNotMet(bytes32 requestHash, uint16 got, uint16 required);
    /// @notice The network changed its verification semantics after this adapter pinned them.
    error ProfileChanged(bytes32 expected, bytes32 actual);

    event AssertionIssuedFromNetwork(
        bytes32 indexed assertionId,
        bytes32 indexed requestHash,
        address network,
        uint16 validatorCount,
        uint8 level
    );

    constructor(
        address kya_,
        address validationRegistry_,
        address network_,
        uint256 subjectChainId_,
        address identityRegistry_,
        uint16 requiredValidators_,
        bytes32 expectedProfile_
    ) {
        kya = IKYARegistry(kya_);
        validationRegistry = IERC8004ValidationStatus(validationRegistry_);
        network = IValidationNetwork8294(network_);
        subjectChainId = subjectChainId_;
        identityRegistry = identityRegistry_;
        requiredValidators = requiredValidators_;
        expectedProfile = expectedProfile_;
    }

    /// @notice Map an ERC-8004 validation response (0–100) onto a scheme's ordered level.
    /// @dev Deliberately NOT a function of 0: a 0 response is a substantive negative result
    ///      from a completed run, and is distinct from a run that did not complete. The caller
    ///      can only reach this function at all once `state == RESPONDED`.
    function _level(uint8 response) internal pure returns (uint8) {
        if (response >= 90) return 3;
        if (response >= 70) return 2;
        if (response >= 50) return 1;
        return 0; // completed, and the network's verdict is negative
    }

    /// @dev The subject must be the `erc8004` subject on the chain and identity registry this
    ///      adapter is pinned to, so a result cannot be re-pointed at a subject elsewhere.
    function _requireSubject(IKYATypes.Subject calldata subject) private view returns (uint256 agentId) {
        if (subject.subjectType != SUBJECT_TYPE_ERC8004) revert UnsupportedSubject();
        (uint256 chainId_, address identity_, uint256 agentId_) =
            abi.decode(subject.subjectData, (uint256, address, uint256));
        if (chainId_ != subjectChainId || identity_ != identityRegistry) revert UnsupportedSubject();
        return agentId_;
    }

    /// @dev The operational-failure boundary. Returns only once the run has actually completed
    ///      under the pinned profile with the required validator count; otherwise reverts.
    ///      Deliberately checked BEFORE any response value is read, so an incomplete run can
    ///      never be mapped to a level at all.
    function _requireCompleted(bytes32 requestHash) private view returns (uint16 validatorCount) {
        bytes32 profile = network.verificationProfile();
        // Compared, then discarded: the evidence preimage below re-reads it rather than reusing
        // `expectedProfile`, so the commitment names the profile that was OBSERVED and does not
        // depend on this check having run. A collapsed value must not hide which state produced it.
        if (profile != expectedProfile) revert ProfileChanged(expectedProfile, profile);
        (uint8 state, uint16 count, bool aggregated) = network.status(requestHash);
        if (state != STATE_RESPONDED || !aggregated) {
            revert ResultNotEstablished(requestHash, state, aggregated);
        }
        if (count < requiredValidators) revert QuorumNotMet(requestHash, count, requiredValidators);
        return count;
    }

    /// @dev The completed run must be about the agent being asserted about, and must have been
    ///      produced by the network this adapter trusts.
    function _requireMatchingResult(bytes32 requestHash, uint256 assertedAgentId)
        private
        view
        returns (uint8 response, bytes32 responseHash)
    {
        (address reported, uint256 reportedAgentId, uint8 response_, bytes32 responseHash_,,) =
            validationRegistry.getValidationStatus(requestHash);
        if (reported != address(network)) revert NotExpectedNetwork(reported, address(network));
        if (reportedAgentId != assertedAgentId) revert SubjectMismatch(reportedAgentId, assertedAgentId);
        return (response_, responseHash_);
    }

    /// @dev Source provenance, retained: everything needed to re-derive this conclusion from
    ///      the 8294 run — which network, which request, which aggregated response, under which
    ///      verification profile, with how many validators. The profile is RE-READ rather than
    ///      taken from `expectedProfile`, so the commitment names what was observed and stays
    ///      correct even if the equality check above were ever moved or removed. In its own
    ///      frame to keep issueFromValidation off a deep stack.
    function _evidenceHash(bytes32 requestHash, bytes32 responseHash, uint16 validatorCount, uint8 response)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                "erc8004-validation",
                address(network),
                requestHash,
                responseHash,
                network.verificationProfile(),
                validatorCount,
                response
            )
        );
    }

    /// @notice Issue a KYA assertion from a completed ERC-8294 validation run.
    /// @dev Reverts rather than issuing when the run did not complete or missed quorum. The
    ///      recorded issuer is this adapter.
    ///
    ///      The inner block is deliberate, not style: `attest` takes seven arguments, and
    ///      holding the intermediate reads live across that call puts this function over the
    ///      stack limit under the repo's compiler settings (optimizer on, no viaIR). Scoping
    ///      the reads frees their slots before the call, which avoids asking the whole repo to
    ///      switch to viaIR and change every deployed bytecode for one contract's sake.
    function issueFromValidation(
        IKYATypes.Subject calldata subject,
        bytes32 schemeId,
        bytes32 requestHash,
        uint64 expiresAt,
        string calldata evidenceURI
    ) external returns (bytes32 assertionId) {
        uint8 level;
        uint16 validators;
        bytes32 claimDigest;
        bytes32 evidenceHash;
        {
            validators = _requireCompleted(requestHash);
            (uint8 response, bytes32 responseHash) =
                _requireMatchingResult(requestHash, _requireSubject(subject));
            level = _level(response);
            claimDigest = keccak256(abi.encode(requestHash, responseHash, response));
            evidenceHash = _evidenceHash(requestHash, responseHash, validators, response);
        }

        assertionId =
            kya.attest(subject, schemeId, level, claimDigest, expiresAt, evidenceURI, evidenceHash);
        emit AssertionIssuedFromNetwork(assertionId, requestHash, address(network), validators, level);
    }
}
