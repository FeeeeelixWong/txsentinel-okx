# TxSentinel

TxSentinel is a deterministic transaction policy firewall for autonomous agents. Before an agent signs an onchain action, TxSentinel evaluates its intent, policy limits, and supplied simulation evidence, then returns an explainable `ALLOW`, `HOLD`, or `DENY` receipt.

- Live product: [txsentinel-okx.vercel.app](https://txsentinel-okx.vercel.app)
- Free review API: [txsentinel-okx.vercel.app/api/check](https://txsentinel-okx.vercel.app/api/check)
- ASP candidate: `TxSentinel #6828`, listing review submitted
- Hackathon: OKX.AI Genesis Hackathon

## Why It Exists

Agent wallets make autonomous actions possible, but autonomy without a pre-sign policy boundary is unsafe. Most transaction simulators answer whether a transaction *can* execute. TxSentinel answers whether the agent *should* execute it under a specific mandate.

Every decision contains:

- a normalized action and immutable policy snapshot
- structured rule evidence and a deterministic risk score
- an action digest and SHA-256 receipt hash
- no private keys, signing authority, or broadcast capability

## Try It

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

## Decision Model

| Decision | Meaning | Representative rules |
| --- | --- | --- |
| `ALLOW` | Every supplied constraint passes | Safe transfer inside spend and fee limits |
| `HOLD` | Human or upstream evidence is required | Spend cap, allowlist, simulation, contract, slippage, fee |
| `DENY` | The action violates a hard boundary | Unsupported chain, blocked recipient, revert, unlimited approval |

Supported chains are X Layer, Ethereum, Base, and Solana. Supported operations are transfer, swap, token approval, and contract call.

## OKX Integration

TxSentinel uses two deliberately isolated surfaces:

1. `POST /api/check` is the free ASP review endpoint and remains stable while listing review is in progress.
2. `POST /api/check-paid` uses the official `@okxweb3/x402-express`, `@okxweb3/x402-core`, and `@okxweb3/x402-evm` packages. It activates only when facilitator credentials and a receiving address are configured.

When activated, an unpaid request receives HTTP `402` with `PAYMENT-REQUIRED`. An OKX Agentic Wallet signs the payment, retries with `PAYMENT-SIGNATURE`, and receives the policy result plus `PAYMENT-RESPONSE` after settlement.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the exact trust boundary and [docs/API.md](docs/API.md) for the request contract.

## Local Development

```bash
npm install
npm test
npm run check
npx vercel@53.4.0 dev --listen 8791
npm run smoke
```

The test suite covers policy boundaries, normalization, receipt determinism, input rejection, and HTTP behavior. The smoke suite exercises all three decisions against a running deployment and verifies the x402 readiness state.

## Official x402 Activation

```bash
cp .env.example .env.local
# Fill OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE and PAY_TO_ADDRESS
npx vercel@53.4.0 env add OKX_API_KEY production
npx vercel@53.4.0 env add OKX_SECRET_KEY production
npx vercel@53.4.0 env add OKX_PASSPHRASE production
npx vercel@53.4.0 env add PAY_TO_ADDRESS production
```

The default network is X Layer testnet (`eip155:1952`). Switch to X Layer mainnet (`eip155:196`) only after end-to-end testnet settlement evidence exists.

## Security

TxSentinel is read-only. It rejects unknown top-level and policy fields, caps request size on the paid endpoint, never accepts a private key field, and cannot sign or broadcast transactions. Supplied simulation evidence is labeled as evidence, not represented as an RPC simulation performed by TxSentinel.

## Repository Map

```text
api/check.js          Free deterministic policy endpoint
api/check-paid.js     Official OKX x402 protected endpoint
lib/policy.js         Pure policy and receipt engine
public/               Interactive product console
scripts/smoke.mjs     Deployment smoke suite
test/                 Policy and HTTP contract tests
```

## Status

- Live policy product and public API: complete
- ASP `#6828` activation and listing review: submitted
- Official x402 server integration: implemented
- Real x402 settlement: pending deployment credentials and funded testnet payer evidence
