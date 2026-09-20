// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import {IKYAVerifier} from "../interfaces/IKYAVerifier.sol";
import {IGroth16Verifier13} from "../verifiers/Groth16KYAVerifierAdapter.sol";
import {IERC8004IdentityRegistry} from "../interfaces/IERC8004Validation.sol";

/// @dev TEST ONLY. Accepts a proof iff proof == abi.encode(keccak256(publicInputs), secret).
///      Demonstrates the adapter contract shape without a real circuit.
contract MockKYAVerifier is IKYAVerifier {
    bytes32 public immutable secret;

    constructor(bytes32 secret_) {
        secret = secret_;
    }

    function verify(bytes32, bytes calldata publicInputs, bytes calldata proof)
        external
        view
        returns (bool ok, bytes32 subjectKey, bytes32 nullifier, uint8 level, bytes32 claimDigest, uint64 expiresAt, bytes32 anchor)
    {
        (subjectKey, nullifier, level, claimDigest, expiresAt) =
            abi.decode(publicInputs, (bytes32, bytes32, uint8, bytes32, uint64));
        ok = keccak256(proof) == keccak256(abi.encode(keccak256(publicInputs), secret));
        if (!ok) return (false, 0, 0, 0, 0, 0, 0);
        anchor = keccak256("mock-anchor");
    }
}

/// @dev TEST ONLY. A verifier that can be destroyed/redeployed to simulate a code change under a stable
///      address is not expressible in plain Solidity ≥0.8.18 (selfdestruct semantics); the regression test
///      instead swaps the address behind a minimal proxy. This is that proxy.
contract MockVerifierProxy is IKYAVerifier {
    address public impl;
    constructor(address impl_) { impl = impl_; }
    function setImpl(address impl_) external { impl = impl_; }
    function verify(bytes32 schemeId, bytes calldata publicInputs, bytes calldata proof)
        external
        view
        returns (bool, bytes32, bytes32, uint8, bytes32, uint64, bytes32)
    {
        return IKYAVerifier(impl).verify(schemeId, publicInputs, proof);
    }
}

/// @dev TEST ONLY. Groth16 stand-in that accepts when a[0] == 1.
contract MockGroth16Verifier13 is IGroth16Verifier13 {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata, uint256[2] calldata, uint256[13] calldata)
        external
        pure
        returns (bool)
    {
        return a[0] == 1;
    }
}

/// @dev TEST ONLY. Minimal ERC-8004 Identity Registry: ownerOf + metadata.
contract MockIdentityRegistry is IERC8004IdentityRegistry {
    uint256 public nextId = 1;
    mapping(uint256 => address) private _owner;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;
    mapping(uint256 => mapping(string => bytes)) private _meta;

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue);

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = nextId++;
        _owner[agentId] = msg.sender;
        emit Registered(agentId, agentURI, msg.sender);
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        require(_owner[agentId] != address(0), "no agent");
        return _owner[agentId];
    }

    /// @dev TEST ONLY: simulate an ERC-721 transfer of the agent.
    function transferFrom(address from, uint256 agentId, address to) external {
        require(_owner[agentId] == from && msg.sender == from, "not owner");
        _owner[agentId] = to;
        _approved[agentId] = address(0);
    }

    function approve(uint256 agentId, address to) external {
        require(_owner[agentId] == msg.sender, "not owner");
        _approved[agentId] = to;
    }

    function getApproved(uint256 agentId) external view returns (address) {
        return _approved[agentId];
    }

    function setApprovalForAll(address op, bool ok) external {
        _operator[msg.sender][op] = ok;
    }

    function isApprovedForAll(address owner_, address op) external view returns (bool) {
        return _operator[owner_][op];
    }

    function setMetadata(uint256 agentId, string memory key, bytes memory value) external {
        require(_isAuth(agentId, msg.sender), "not authorized");
        require(keccak256(bytes(key)) != keccak256("agentWallet"), "reserved");
        _meta[agentId][key] = value;
        emit MetadataSet(agentId, key, key, value);
    }

    function getMetadata(uint256 agentId, string memory key) external view returns (bytes memory) {
        return _meta[agentId][key];
    }

    function _isAuth(uint256 agentId, address who) internal view returns (bool) {
        address o = _owner[agentId];
        return who == o || who == _approved[agentId] || _operator[o][who];
    }

    function isAuthorized(uint256 agentId, address who) external view returns (bool) {
        return _isAuth(agentId, who);
    }
}
