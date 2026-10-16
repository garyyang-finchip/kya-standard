// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

interface IERC8004ValidationResponse {
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external;
}

/// @dev TEST ONLY. Minimal ERC-8294 validation network: just the surface
///      ValidationNetwork8294Adapter reads — `status()` and `verificationProfile()`.
///
///      Selection, signature collection and aggregation are ERC-8294's concern and are not
///      modelled here; what matters for the composition vectors is that the adapter can
///      observe the three outcomes a real network produces:
///
///        state 1 (pending)   — the run has not finished
///        state 3 (failed)    — the run finished without a usable aggregate
///        state 2 (responded) — an aggregate exists, with a validator count
///
///      and that it treats the first two as "nothing established" rather than as a verdict.
contract MockValidationNetwork8294 {
    uint8 private _state;
    uint16 private _validatorCount;
    bool private _responseAggregated;
    bytes32 private _profile;

    constructor(bytes32 profile_) {
        _profile = profile_;
    }

    function setStatus(uint8 state_, uint16 validatorCount_, bool responseAggregated_) external {
        _state = state_;
        _validatorCount = validatorCount_;
        _responseAggregated = responseAggregated_;
    }

    /// @dev Lets the regression case move the network's semantics after an adapter pinned them.
    function setProfile(bytes32 profile_) external {
        _profile = profile_;
    }

    /// @dev The network is the ERC-8004 `validatorAddress`, so only IT may write the response.
    ///      Mirrors ERC-8294's aggregation step: the network submits one aggregated verdict.
    function submitAggregate(
        address registry,
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external {
        IERC8004ValidationResponse(registry).validationResponse(
            requestHash, response, responseURI, responseHash, tag
        );
    }

    function status(bytes32)
        external
        view
        returns (uint8 state, uint16 validatorCount, bool responseAggregated)
    {
        return (_state, _validatorCount, _responseAggregated);
    }

    function verificationProfile() external view returns (bytes32) {
        return _profile;
    }
}
