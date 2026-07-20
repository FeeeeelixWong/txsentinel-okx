# TxSentinel Visual Guide

This guide explains where a policy check starts, what OKX Wallet signs, and exactly what X Layer
stores. It describes the implemented hackathon build; future enforcement modules are labeled
separately.

## 1. The 30-Second Mental Model

```mermaid
flowchart LR
  A["1. Agent constructs<br/>a proposed action"] --> B["2. TxSentinel evaluates<br/>rules and evidence"]
  B --> C{"3. Decision"}
  C -->|"ALLOW"| D["Wallet may continue"]
  C -->|"HOLD"| E["Ask a human"]
  C -->|"DENY"| F["Stop the action"]
  C --> G["4. Produce deterministic<br/>action and receipt hashes"]
  G --> H["5. Optional X Layer<br/>receipt attestation"]
```

The trigger is the moment after the agent knows what it wants to do but before a wallet signs the
underlying transaction. TxSentinel never receives a private key and cannot broadcast that action.

## 2. One-Time Setup and Per-Action Flow

```mermaid
sequenceDiagram
  actor A as Agent or user
  participant T as TxSentinel API
  participant W as OKX Wallet
  participant C as Canonical X Layer contract
  participant D as Target dApp or recipient

  Note over W,C: ONE TIME PER POLICY OWNER
  W->>C: registerPolicy(policyKey, policyHash, versionHash)
  C-->>W: PolicyRegistered(owner, revision 1)

  Note over A,C: EACH POLICY EVALUATION
  A->>T: POST /api/check(action, policy, evidence)
  T->>T: Normalize, validate, evaluate, hash
  T-->>A: decision + reasons + actionDigest + receiptHash

  opt Independently verifiable evidence
    A->>W: Ask to attest receipt
    W->>C: anchorReceipt(receiptHash, actionDigest, decision)
    C-->>W: ReceiptAnchored(policy revision, block time)
  end

  alt Decision is ALLOW
    A->>W: Separately request the underlying transaction
    W->>D: Sign and submit only after wallet confirmation
  else Decision is HOLD
    A-->>A: Wait for human approval or more evidence
  else Decision is DENY
    A-->>A: Do not request execution
  end
```

The receipt-attestation transaction and the underlying asset transaction are deliberately separate.
The current contract proves that an address attested to a decision; it does not enforce execution.

## 3. Who Defines the Rules?

```mermaid
flowchart TB
  subgraph USER["Policy owner controls"]
    U1["Maximum spend"]
    U2["Recipient allowlist / blocklist"]
    U3["Simulation and verification requirements"]
    U4["Slippage and fee limits"]
  end

  subgraph SYSTEM["TxSentinel always enforces"]
    S1["Strict request schema"]
    S2["Supported chains and operations"]
    S3["Finite non-negative values"]
    S4["Deterministic normalization"]
  end

  USER --> P["Normalized policy snapshot"]
  SYSTEM --> P
  P --> E["Pure decision engine"]
  E --> R["ALLOW / HOLD / DENY receipt"]
```

The user chooses risk appetite; TxSentinel owns the validation and determinism rules that prevent an
agent from silently changing the meaning of the request.

### Canonical hackathon Policy v1

| Rule | Value |
| --- | ---: |
| Maximum spend | 100 USD |
| Unlimited approvals | Denied |
| Simulation evidence | Required |
| Maximum slippage | 100 bps |
| Maximum estimated fee | 5 USD |
| Verified contract | Not required in v1 |

## 4. What the X Layer Contract Stores

```mermaid
flowchart LR
  O["Policy owner address"] --> N["Owner-scoped namespace"]
  K["Policy key"] --> N
  N --> P["Current policy<br/>policyHash<br/>versionHash<br/>revision<br/>active"]
  P --> R1["Receipt A snapshot<br/>revision 1 + decision"]
  P --> R2["Receipt B snapshot<br/>revision 2 + decision"]
  D["Policy-scoped delegate"] -->|"may anchor only when authorized"| R2
```

Each receipt copies the exact policy hash, version hash, and revision active at anchor time. Updating
the policy cannot rewrite historical evidence. Receipt uniqueness is scoped to the policy owner and
policy key, preventing unrelated accounts from occupying another owner's receipt namespace.

## 5. Policy Lifecycle

```mermaid
flowchart LR
  U["Unregistered"] -->|"registerPolicy"| V1["Active policy<br/>revision 1"]
  V1 -->|"anchorReceipt"| R1["Immutable receipt<br/>revision 1 snapshot"]
  V1 -->|"updatePolicy"| V2["Active policy<br/>revision 2"]
  V2 -->|"anchorReceipt"| R2["Immutable receipt<br/>revision 2 snapshot"]
  V2 -->|"setPolicyActive false"| I["Inactive policy"]
  I -->|"setPolicyActive true"| V2
  V2 -. "cannot rewrite" .-> R1
```

Registration is once per `owner + policyKey`. Rule changes use `updatePolicy` rather than deploying a
new contract. An inactive policy fails closed and cannot accept new receipt anchors.

## 6. Trust Boundary

| Component | Can do | Cannot do |
| --- | --- | --- |
| TxSentinel API | Validate proposals, evaluate policy, produce deterministic hashes | Read a private key, sign, or broadcast |
| OKX Wallet | Show and sign explicit user-approved transactions | Change the reviewed contract bytecode |
| X Layer anchor | Store policy versions and immutable receipt snapshots | Hold assets, approve tokens, call target contracts, or execute the proposed action |
| Agent | Propose actions and react to decisions | Bypass wallet confirmation through TxSentinel |

## 7. Current Onchain Evidence

```mermaid
flowchart LR
  A["Reviewed Solidity source"] --> B["Reproducible compiler artifact"]
  B --> C["Canonical deployment<br/>0x295975...bb213"]
  C --> D["Runtime bytecode hash<br/>0xd81838...c763"]
  D --> E["Policy registration<br/>next one-time action"]
  E --> F["Live receipt anchor"]
```

- [Canonical X Layer Testnet contract](https://www.okx.com/web3/explorer/xlayer-test/address/0x295975cbec1673061d11c223b35a8513d1ebb213)
- [Deployment transaction](https://www.okx.com/web3/explorer/xlayer-test/tx/0x6604803fda9b0b298ed18ea1e3e9dfc4b58b05e0f2989652f64500e8aa741ae9)
- [Security review](../SECURITY_REVIEW.md)
- [Contract source](../contracts/TxSentinelPolicyAnchor.sol)

## 8. Current vs. Future Enforcement

```mermaid
flowchart LR
  subgraph NOW["Current evidence model"]
    A["Policy decision"] --> B["Wallet attestation"] --> C["X Layer receipt"]
  end
  subgraph FUTURE["Production enforcement option"]
    D["Policy decision"] --> E["Safe module or ERC-4337 validator"] --> F["Execution allowed only with valid receipt"]
  end
```

The future module is a documented replacement point, not a claim about the current build.
