# 🛡️ TxSentinel

> A deterministic transaction policy firewall for autonomous agents.

Before an agent signs an onchain action, TxSentinel evaluates its intent, policy limits, and supplied
simulation evidence. It then returns an explainable `ALLOW`, `HOLD`, or `DENY` receipt without taking
custody, signing transactions, or broadcasting them.

## 🔗 Quick Links

| Experience | Link | Purpose |
| --- | --- | --- |
| 🚀 Live product | [Open TxSentinel](https://txsentinel-okx.vercel.app) | Product overview and guided workflow |
| 🧪 Policy evaluator | [Evaluate an action](https://txsentinel-okx.vercel.app/evaluate.html) | Test `ALLOW`, `HOLD`, and `DENY` decisions |
| ⛓️ Onchain console | [Verify on X Layer](https://txsentinel-okx.vercel.app/onchain.html) | Register a policy and anchor a receipt |
| 🔌 Integration guide | [Integrate an agent](https://txsentinel-okx.vercel.app/integrate.html) | Connect an agent or wallet workflow |
| 📡 Free review API | [`POST /api/check`](https://txsentinel-okx.vercel.app/api/check) | Deterministic public evaluation endpoint |

**Project status:** ASP candidate `TxSentinel #6828` · Listing review submitted<br>
**Built for:** OKX.AI Genesis Hackathon

## 📚 Documentation

- [Visual product guide](docs/VISUAL_GUIDE.md)
- [Architecture and trust boundaries](ARCHITECTURE.md)
- [API contract](docs/API.md)
- [Policy FAQ](#policy-faq)

## 🗺️ Product in One Picture

![TxSentinel product flow](docs/assets/product-overview.svg)

1. An agent constructs an action.
2. TxSentinel evaluates the action **before it is signed**.
3. The policy engine returns `ALLOW`, `HOLD`, or `DENY` with deterministic evidence.
4. The wallet may anchor the receipt to X Layer without giving the contract custody or execution authority.

## ⛓️ What Is Onchain?

![TxSentinel onchain sequence](docs/assets/onchain-sequence.svg)

`registerPolicy` does not approve tokens or move funds. It binds a wallet to a policy hash and
revision. `anchorReceipt` stores evidence of a decision; it does not execute the underlying action.

## 🎯 Why It Exists

Agent wallets make autonomous actions possible, but autonomy without a pre-sign policy boundary is unsafe. Most transaction simulators answer whether a transaction *can* execute. TxSentinel answers whether the agent *should* execute it under a specific mandate.

Every decision contains:

- a normalized action and immutable policy snapshot
- structured rule evidence and a deterministic risk score
- an action digest and SHA-256 receipt hash
- no private keys, signing authority, or broadcast capability

## ⚡ Try It

```bash
curl -sS https://txsentinel-okx.vercel.app/api/check \
  -H 'Content-Type: application/json' \
  -d '{
    "chain":"xlayer",
    "operation":"transfer",
    "to":"0x4a6aae28b27681856ae824af82fea87896ecc3ed",
    "amountUsd":25,
    "policy":{"maxSpendUsd":100,"requireSimulation":true},
    "simulation":{"status":"succeeded","estimatedFeeUsd":0.01}
  }'
```

The endpoint also accepts an empty POST and evaluates a documented review sample, so marketplace reviewers can verify availability immediately.

## 🚦 Decision Model

| Decision | Meaning | Representative rules |
| --- | --- | --- |
| `ALLOW` | Every supplied constraint passes | Safe transfer inside spend and fee limits |
| `HOLD` | Human or upstream evidence is required | Spend cap, allowlist, simulation, contract, slippage, fee |
| `DENY` | The action violates a hard boundary | Unsupported chain, blocked recipient, revert, unlimited approval |

Supported chains are X Layer, Ethereum, Base, and Solana. Supported operations are transfer, swap, token approval, and contract call.

## 👤 Policy Ownership

| Layer | Controlled by | Examples |
| --- | --- | --- |
| User policy | Policy owner | Spend cap, recipient lists, simulation requirement, slippage and fee limits |
| System safety rails | TxSentinel | Strict schema, supported operations, non-negative values, deterministic normalization |
| Onchain snapshot | X Layer contract | Owner, policy hash, version, revision, active status, anchored receipts |

The current onchain demo registers a reviewed canonical Policy v1. A later policy update increments
the revision; receipts already anchored against an older revision do not change.

## 🔌 OKX Integration

TxSentinel uses two deliberately isolated surfaces:

1. `POST /api/check` is the free ASP review endpoint and remains stable while listing review is in progress.
2. `POST /api/check-paid` uses the official `@okxweb3/x402-express`, `@okxweb3/x402-core`, and `@okxweb3/x402-evm` packages. It activates only when facilitator credentials and a receiving address are configured.

When activated, an unpaid request receives HTTP `402` with `PAYMENT-REQUIRED`. An OKX Agentic Wallet signs the payment, retries with `PAYMENT-SIGNATURE`, and receives the policy result plus `PAYMENT-RESPONSE` after settlement.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the exact trust boundary and [docs/API.md](docs/API.md) for the request contract.

## 🧑‍💻 Local Development

```bash
npm install
npm test
npm run check
npx vercel@53.4.0 dev --listen 8791
npm run smoke
```

The test suite covers policy boundaries, normalization, receipt determinism, input rejection, and HTTP behavior. The smoke suite exercises all three decisions against a running deployment and verifies the x402 readiness state.

## 💳 Official x402 Activation

```bash
cp .env.example .env.local
# Fill OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE and PAY_TO_ADDRESS
npx vercel@53.4.0 env add OKX_API_KEY production
npx vercel@53.4.0 env add OKX_SECRET_KEY production
npx vercel@53.4.0 env add OKX_PASSPHRASE production
npx vercel@53.4.0 env add PAY_TO_ADDRESS production
```

The default network is X Layer testnet (`eip155:1952`). Switch to X Layer mainnet (`eip155:196`) only after end-to-end testnet settlement evidence exists.

## 🔗 X Layer Receipt Anchor

The optional `TxSentinelPolicyAnchor` contract stores immutable policy-version snapshots and
deterministic receipt hashes. Open `/onchain.html` to connect OKX Wallet, verify the canonical X
Layer Testnet deployment, register policy v1, run a live policy evaluation, and anchor its receipt.
The contract cannot hold or transfer assets and does not receive signing authority.

- Canonical X Layer Testnet contract: [`0x295975cbec1673061d11c223b35a8513d1ebb213`](https://www.okx.com/web3/explorer/xlayer-test/address/0x295975cbec1673061d11c223b35a8513d1ebb213)
- Deployment transaction: [`0x6604803f...741ae9`](https://www.okx.com/web3/explorer/xlayer-test/tx/0x6604803fda9b0b298ed18ea1e3e9dfc4b58b05e0f2989652f64500e8aa741ae9)
- Runtime bytecode hash: `0xd81838ab32626c1956fe06fb9551718b0b40b16ad54079dba38612e811c3c763`

```bash
npm run contract:compile
npm run contract:lint
npm run contract:test
```

<a id="policy-faq"></a>

## ❓ Policy FAQ

### 1. Can one wallet own multiple policies?

**Yes.** Policies are stored under `(owner address, policyKey)`, so one wallet can register multiple
independent policies by using different policy keys. Each policy has its own ruleset hash, version,
revision, active status, delegates, and receipt history. Different wallets may also reuse the same
application-defined policy key because each owner's namespace is isolated.

### 2. Can a policy be updated?

**Yes.** The policy owner can call `updatePolicy` with a replacement policy hash and version hash. The
contract increments the policy revision on every update. Updating an inactive policy does not
automatically reactivate it.

Previously anchored receipts remain unchanged after an update. Every receipt stores the policy
hash, version hash, and revision that were active when that decision was anchored, preserving an
auditable historical snapshot.

### 3. Who can update or disable a policy?

Only the wallet that owns the policy can update it, change its active status, or manage delegates.
A policy-scoped delegate may anchor receipts for that policy but cannot change its rules or status.

### 4. Does a policy expire automatically?

**No.** The current contract has no automatic expiration timestamp. A registered policy remains active
until its owner calls `setPolicyActive(policyKey, false)`. The owner may later reactivate it with
`setPolicyActive(policyKey, true)`.

### 5. Can a policy be deleted or registered again under the same key?

**No.** Onchain policy records are not deleted, and an existing `(owner, policyKey)` cannot be registered
again. The owner should update the existing policy, deactivate it, or register a new policy under a
different key. This prevents historical receipts from losing their policy identity.

### 6. Does the current web console expose all of these controls?

**Not yet.** The deployed contract supports multiple policies, updates, activation controls, and
policy-scoped delegates. The current hackathon console intentionally presents one reviewed canonical
Policy v1 so the end-to-end registration and receipt flow stays easy to verify.

## 🔒 Security

TxSentinel is read-only. It rejects unknown top-level and policy fields, caps request size on the paid endpoint, never accepts a private key field, and cannot sign or broadcast transactions. Supplied simulation evidence is labeled as evidence, not represented as an RPC simulation performed by TxSentinel.

## 🗂️ Repository Map

```text
api/check.js          Free deterministic policy endpoint
api/check-paid.js     Official OKX x402 protected endpoint
lib/policy.js         Pure policy and receipt engine
public/               Overview, four-step evaluator, onchain console, and integration guide
contracts/            Non-custodial X Layer policy receipt anchor
scripts/smoke.mjs     Deployment smoke suite
test/                 Policy and HTTP contract tests
```

## ✅ Status

- ✅ Live policy product and public API: complete
- ✅ ASP `#6828` activation and listing review: submitted
- ✅ Official x402 server integration: implemented
- ⏳ Real x402 settlement: pending deployment credentials and funded testnet payer evidence
