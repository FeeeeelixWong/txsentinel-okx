// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TxSentinel Policy Anchor
/// @author TxSentinel
/// @notice Records policy versions and deterministic decision receipts without
///         taking custody of assets or executing transactions.
contract TxSentinelPolicyAnchor {
    enum Decision {
        ALLOW,
        HOLD,
        DENY
    }

    struct Policy {
        bytes32 policyHash;
        bytes32 versionHash;
        uint64 revision;
        bool active;
    }

    struct Receipt {
        bytes32 actionDigest;
        bytes32 policyHash;
        bytes32 versionHash;
        address submitter;
        uint64 policyRevision;
        uint64 anchoredAt;
        Decision decision;
    }

    error InvalidValue();
    error PolicyAlreadyExists();
    error PolicyNotFound();
    error Unauthorized();
    error PolicyInactive();
    error ReceiptAlreadyAnchored();

    /// @notice Policy state scoped by owner and application-defined policy key.
    mapping(address owner => mapping(bytes32 policyKey => Policy policy)) public policies;
    /// @notice Revocable delegate permission scoped to one owner and policy key.
    mapping(address owner => mapping(bytes32 policyKey => mapping(address delegate => bool allowed)))
        public delegates;
    /// @notice Immutable receipt snapshots scoped to one owner and policy key.
    mapping(
        address owner => mapping(bytes32 policyKey => mapping(bytes32 receiptHash => Receipt receipt))
    ) public receipts;

    /// @notice Emitted when an owner registers a new policy namespace.
    /// @param owner Wallet that owns the policy.
    /// @param policyKey Application-defined identifier inside the owner's namespace.
    /// @param policyHash Hash of the canonical ruleset.
    /// @param versionHash Hash of the human-readable policy version.
    event PolicyRegistered(
        address indexed owner,
        bytes32 indexed policyKey,
        bytes32 policyHash,
        bytes32 versionHash
    );
    /// @notice Emitted when an owner replaces the active policy version.
    /// @param owner Wallet that owns the policy.
    /// @param policyKey Application-defined identifier inside the owner's namespace.
    /// @param revision Monotonically increasing policy revision.
    /// @param policyHash Hash of the replacement ruleset.
    /// @param versionHash Hash of the replacement version.
    event PolicyUpdated(
        address indexed owner,
        bytes32 indexed policyKey,
        uint64 indexed revision,
        bytes32 policyHash,
        bytes32 versionHash
    );
    /// @notice Emitted when an owner enables or disables receipt anchoring.
    /// @param owner Wallet that owns the policy.
    /// @param policyKey Application-defined identifier inside the owner's namespace.
    /// @param active Whether the policy accepts new receipt anchors.
    event PolicyStatusChanged(
        address indexed owner,
        bytes32 indexed policyKey,
        bool indexed active
    );
    /// @notice Emitted when a policy-scoped delegate is granted or revoked.
    /// @param owner Wallet that owns the policy.
    /// @param policyKey Application-defined identifier inside the owner's namespace.
    /// @param delegate Address whose permission changed.
    /// @param allowed Whether the delegate is now authorized.
    event DelegateSet(
        address indexed owner,
        bytes32 indexed policyKey,
        address indexed delegate,
        bool allowed
    );
    /// @notice Emitted after a deterministic receipt and its policy snapshot are stored.
    /// @param owner Wallet that owns the referenced policy.
    /// @param policyKey Application-defined identifier inside the owner's namespace.
    /// @param receiptHash Deterministic offchain receipt hash.
    /// @param submitter Owner or policy-scoped delegate that submitted the anchor.
    /// @param actionDigest Deterministic digest of the evaluated action.
    /// @param policyHash Ruleset hash captured at anchor time.
    /// @param versionHash Policy version hash captured at anchor time.
    /// @param policyRevision Revision captured at anchor time.
    /// @param decision Offchain policy decision represented by the receipt.
    event ReceiptAnchored(
        address indexed owner,
        bytes32 indexed policyKey,
        bytes32 indexed receiptHash,
        address submitter,
        bytes32 actionDigest,
        bytes32 policyHash,
        bytes32 versionHash,
        uint64 policyRevision,
        Decision decision
    );

    /// @notice Registers a new policy in the caller's namespace.
    /// @param policyKey Application-defined identifier that is unique for this owner.
    /// @param policyHash Hash of the canonical policy rules.
    /// @param versionHash Hash of the policy version label.
    function registerPolicy(bytes32 policyKey, bytes32 policyHash, bytes32 versionHash) external {
        if (policyKey == bytes32(0) || policyHash == bytes32(0) || versionHash == bytes32(0)) {
            revert InvalidValue();
        }
        if (policies[msg.sender][policyKey].revision != 0) revert PolicyAlreadyExists();

        policies[msg.sender][policyKey] = Policy({
            policyHash: policyHash,
            versionHash: versionHash,
            revision: 1,
            active: true
        });

        emit PolicyRegistered(msg.sender, policyKey, policyHash, versionHash);
    }

    /// @notice Replaces a policy's hashes and increments its revision.
    /// @param policyKey Existing key in the caller's namespace.
    /// @param policyHash Hash of the replacement ruleset.
    /// @param versionHash Hash of the replacement version label.
    function updatePolicy(bytes32 policyKey, bytes32 policyHash, bytes32 versionHash) external {
        Policy storage policy = _ownedPolicy(policyKey);
        if (policyHash == bytes32(0) || versionHash == bytes32(0)) revert InvalidValue();

        policy.policyHash = policyHash;
        policy.versionHash = versionHash;
        ++policy.revision;

        emit PolicyUpdated(msg.sender, policyKey, policy.revision, policyHash, versionHash);
    }

    /// @notice Enables or disables future receipt anchors for a policy.
    /// @param policyKey Existing key in the caller's namespace.
    /// @param active Whether new receipts may be anchored.
    function setPolicyActive(bytes32 policyKey, bool active) external {
        Policy storage policy = _ownedPolicy(policyKey);
        policy.active = active;
        emit PolicyStatusChanged(msg.sender, policyKey, active);
    }

    /// @notice Grants or revokes a delegate for exactly one policy.
    /// @param policyKey Existing key in the caller's namespace.
    /// @param delegate Address whose permission is changing.
    /// @param allowed Whether the delegate is authorized.
    function setDelegate(bytes32 policyKey, address delegate, bool allowed) external {
        _ownedPolicy(policyKey);
        if (delegate == address(0) || delegate == msg.sender) revert InvalidValue();
        delegates[msg.sender][policyKey][delegate] = allowed;
        emit DelegateSet(msg.sender, policyKey, delegate, allowed);
    }

    /// @notice Stores an immutable receipt and the current policy snapshot.
    /// @param receiptHash Deterministic offchain receipt hash.
    /// @param policyOwner Wallet that owns the referenced policy.
    /// @param policyKey Existing key in the owner's namespace.
    /// @param actionDigest Deterministic digest of the evaluated action.
    /// @param decision Offchain policy decision represented by the receipt.
    function anchorReceipt(
        bytes32 receiptHash,
        address policyOwner,
        bytes32 policyKey,
        bytes32 actionDigest,
        Decision decision
    ) external {
        if (receiptHash == bytes32(0) || actionDigest == bytes32(0)) revert InvalidValue();
        if (receipts[policyOwner][policyKey][receiptHash].submitter != address(0)) {
            revert ReceiptAlreadyAnchored();
        }

        Policy storage policy = policies[policyOwner][policyKey];
        if (policy.revision == 0) revert PolicyNotFound();
        if (!policy.active) revert PolicyInactive();
        if (msg.sender != policyOwner && !delegates[policyOwner][policyKey][msg.sender]) {
            revert Unauthorized();
        }

        receipts[policyOwner][policyKey][receiptHash] = Receipt({
            actionDigest: actionDigest,
            policyHash: policy.policyHash,
            versionHash: policy.versionHash,
            submitter: msg.sender,
            policyRevision: policy.revision,
            anchoredAt: uint64(block.timestamp),
            decision: decision
        });

        emit ReceiptAnchored(
            policyOwner,
            policyKey,
            receiptHash,
            msg.sender,
            actionDigest,
            policy.policyHash,
            policy.versionHash,
            policy.revision,
            decision
        );
    }

    /// @notice Checks whether an address may anchor receipts for a policy.
    /// @param policyOwner Wallet that owns the referenced policy.
    /// @param policyKey Existing key in the owner's namespace.
    /// @param actor Address to check.
    /// @return Whether the policy is active and the actor may anchor a receipt.
    function isAuthorized(address policyOwner, bytes32 policyKey, address actor)
        external
        view
        returns (bool)
    {
        Policy storage policy = policies[policyOwner][policyKey];
        return policy.revision != 0 && policy.active
            && (actor == policyOwner || delegates[policyOwner][policyKey][actor]);
    }

    function _ownedPolicy(bytes32 policyKey) private view returns (Policy storage policy) {
        policy = policies[msg.sender][policyKey];
        if (policy.revision == 0) revert PolicyNotFound();
    }
}
