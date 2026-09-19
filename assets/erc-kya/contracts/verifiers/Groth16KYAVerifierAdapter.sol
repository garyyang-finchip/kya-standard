// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import {IKYAVerifier} from "../interfaces/IKYAVerifier.sol";

/// @dev snarkjs-style Groth16 verifier with 13 public signals.
interface IGroth16Verifier13 {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[13] calldata input)
        external
        view
        returns (bool);
}

/// @title Groth16KYAVerifierAdapter
/// @notice Adapts a snarkjs-style Groth16 verifier to IKYAVerifier using the canonical
///         `kya-public-v1` layout. 256-bit values are split into (hi128, lo128) field elements so
///         they fit under the BN254 scalar field without truncation.
///
///         publicInputs = abi.encode(bytes32 subjectKey, bytes32 nullifier, uint8 level,
///                                   bytes32 claimDigest, uint64 expiresAt, bytes32 issuerSetRoot,
///                                   uint64 epoch)
///         proof        = abi.encode(uint256[2] a, uint256[2][2] b, uint256[2] c)
///
///         signals (13), in snarkjs order (circuit outputs first, then public inputs):
///           [0] nullifier.hi   [1] nullifier.lo
///           [2] subjectKey.hi  [3] subjectKey.lo  [4] level
///           [5] claimDigest.hi [6] claimDigest.lo [7] expiresAt
///           [8] issuerSetRoot.hi [9] issuerSetRoot.lo
///          [10] schemeId.hi   [11] schemeId.lo   — taken from the `schemeId` argument, so the
///                                                  proof is domain-separated per scheme
///          [12] epoch                            — 0 when the scheme's nullifierScope is "scheme"
///
///         `issuerSetRoot` is exposed so relying parties can pin the attestor set the circuit proved
///         membership in; the adapter optionally enforces a fixed root.
contract Groth16KYAVerifierAdapter is IKYAVerifier {
    IGroth16Verifier13 public immutable groth16;
    bytes32 public immutable requiredIssuerSetRoot; // 0x0 = any

    constructor(address groth16_, bytes32 requiredIssuerSetRoot_) {
        groth16 = IGroth16Verifier13(groth16_);
        requiredIssuerSetRoot = requiredIssuerSetRoot_;
    }

    struct Pub {
        bytes32 subjectKey;
        bytes32 nullifier;
        uint8 level;
        bytes32 claimDigest;
        uint64 expiresAt;
        bytes32 issuerSetRoot;
        uint64 epoch;
    }

    function verify(bytes32 schemeId, bytes calldata publicInputs, bytes calldata proof)
        external
        view
        returns (bool ok, bytes32 subjectKey, bytes32 nullifier, uint8 level, bytes32 claimDigest, uint64 expiresAt)
    {
        Pub memory p = _decode(publicInputs);
        if (requiredIssuerSetRoot != bytes32(0) && p.issuerSetRoot != requiredIssuerSetRoot) {
            return (false, bytes32(0), bytes32(0), 0, bytes32(0), 0);
        }
        ok = _verifyGroth16(schemeId, p, proof);
        if (!ok) return (false, bytes32(0), bytes32(0), 0, bytes32(0), 0);
        return (true, p.subjectKey, p.nullifier, p.level, p.claimDigest, p.expiresAt);
    }

    function _decode(bytes calldata publicInputs) internal pure returns (Pub memory p) {
        (p.subjectKey, p.nullifier, p.level, p.claimDigest, p.expiresAt, p.issuerSetRoot, p.epoch) =
            abi.decode(publicInputs, (bytes32, bytes32, uint8, bytes32, uint64, bytes32, uint64));
    }

    function _verifyGroth16(bytes32 schemeId, Pub memory p, bytes calldata proof) internal view returns (bool) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        return groth16.verifyProof(a, b, c, signals(schemeId, p));
    }

    /// @notice Public-signal vector for (schemeId, p), in the circuit's order. Exposed for tooling.
    function signals(bytes32 schemeId, Pub memory p) public pure returns (uint256[13] memory input) {
        (input[0], input[1]) = _split(p.nullifier);
        (input[2], input[3]) = _split(p.subjectKey);
        input[4] = p.level;
        (input[5], input[6]) = _split(p.claimDigest);
        input[7] = p.expiresAt;
        (input[8], input[9]) = _split(p.issuerSetRoot);
        (input[10], input[11]) = _split(schemeId);
        input[12] = p.epoch;
    }

    function _split(bytes32 v) internal pure returns (uint256 hi, uint256 lo) {
        hi = uint256(v) >> 128;
        lo = uint256(v) & ((uint256(1) << 128) - 1);
    }
}
