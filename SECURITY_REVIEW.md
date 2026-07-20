# TxSentinel Policy Anchor Security Review

Review date: 2026-07-20  
Deployment target: X Layer Testnet (`eip155:1952`)  
Reviewed contract: `contracts/TxSentinelPolicyAnchor.sol`

## Scope and invariants

The contract is an evidence registry, not a wallet or execution engine. Its required invariants are:

1. No code path can receive, custody, approve, transfer, or spend assets.
2. Only a policy owner or that policy's active delegate can anchor a receipt.
3. A policy update cannot change the policy snapshot stored with an older receipt.
4. A third party cannot pre-register or pre-anchor data in another owner's namespace.
5. An inactive policy cannot accept new receipts.

## Findings resolved before deployment

### P0: Global policy identifiers allowed registration griefing

The initial draft used one global mapping keyed by a predictable `policyId`. Another account could
register that ID first and prevent the intended owner from using it. Policies are now scoped by
`owner + policyKey`; identical keys can safely exist for different owners.

### P0: Historical receipts did not pin the policy revision

The initial receipt referenced mutable policy state. Updating a policy would make an old receipt
appear to refer to the new rules. Every receipt now stores the exact policy hash, version hash, and
revision observed at anchor time.

### P1: Delegates had owner-wide authority

The initial delegate mapping authorized an agent across every policy owned by a wallet. Delegation
is now scoped to exactly one `owner + policyKey` and is independently revocable.

### P1: Receipt uniqueness could cross policy boundaries

A receipt hash was initially unique across the whole contract. A public hash could therefore be
submitted in an unrelated namespace first. Uniqueness is now scoped by `owner + policyKey +
receiptHash`.

### P1: Default policy hash did not bind concrete thresholds

The first build hashed a description of rule categories. The deployment artifact now hashes the
canonical policy JSON containing the exact spend, fee, slippage, approval, simulation, and
verification settings. The browser evaluation reads this same artifact.

### P1: Authorization helper disagreed with the write path for inactive policies

The initial read helper returned `true` for an owner or delegate even after a policy was disabled,
while `anchorReceipt` correctly reverted. `isAuthorized` now includes the active-policy check so
wallets and third-party integrations receive the same fail-closed answer as the write path.

## Current attack surface

- No `payable`, `receive`, or `fallback` function.
- No token interface, value transfer, external call, `delegatecall`, assembly, proxy, upgrade hook,
  administrator, or self-destruct path.
- No unbounded loop or user-controlled storage iteration.
- Solidity 0.8 checked arithmetic protects the policy revision counter.
- Enum ABI decoding rejects decisions outside `ALLOW`, `HOLD`, and `DENY`.
- Events expose all state transitions required for independent indexing.

## Residual limitations

- The anchor proves an address attested to hashes; it does not re-execute or validate the offchain
  policy engine. The receipt hash and action digest remain submitter attestations.
- A compromised policy owner can update or deactivate its own policy and manage its delegates.
- Owner key recovery and policy ownership transfer are intentionally omitted. A new wallet must
  register a new namespace while historical receipts remain under the old owner.
- Block timestamps provide normal EVM ordering evidence, not precise wall-clock guarantees.
- This is a testnet hackathon deployment and has not received an independent professional audit or
  formal verification. Production enforcement should use a new reviewed deployment and a Safe or
  ERC-4337 validation module.
- The current dependency registry reports future advisories for transitive `ws` and `qs` versions,
  while the referenced patched versions are not yet available from the configured or public npm
  registry. TxSentinel does not open a WebSocket transport and does not call the affected
  `qs.stringify` option. Re-run `npm audit` and update the official OKX x402 dependency chain before
  a production deployment.

## Verification gates

```bash
npm run contract:compile
npm run contract:lint
npm run contract:test
npm test
npm run check
```

The contract tests cover owner namespace isolation, duplicate protection, policy-scoped delegation,
delegate revocation, authorization failure, historical policy snapshots, inactive policies, zero
identifiers, self-delegation, and invalid enum values.
