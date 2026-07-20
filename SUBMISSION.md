# TxSentinel Hackathon Submission

## One-Line Pitch

TxSentinel is a deterministic transaction policy firewall that gives autonomous agents an explainable `ALLOW`, `HOLD`, or `DENY` receipt before signing.

## Problem

Agentic wallets can plan, pay, trade, and interact with contracts, but a transaction that is technically executable may still violate the user's mandate. Spend caps, approved recipients, approval scope, simulation results, fee limits, and contract trust are usually scattered across application code and are difficult to audit after the fact.

## Product

TxSentinel turns those constraints into one pre-sign API. The agent submits a proposed action and receives a normalized policy snapshot, risk score, structured evidence, action digest, and deterministic receipt hash. Hard violations are denied, ambiguous cases are held for review, and compliant actions are allowed.

## Why OKX

- X Layer is a first-class supported chain and is the default product scenario.
- TxSentinel is registered as an OKX ASP candidate, agent `#6828`.
- The paid route integrates the official OKX x402 Node packages and isolates payment settlement from policy logic.
- The design complements Agentic Wallet: the wallet remains the signer while TxSentinel acts as a read-only authorization boundary.

## What Is Live

- Interactive console: https://txsentinel-okx.vercel.app
- Free policy API: https://txsentinel-okx.vercel.app/api/check
- Source: https://github.com/FeeeeelixWong/txsentinel-okx
- 20 automated policy, HTTP, and official x402 middleware tests
- Deployment smoke for `ALLOW`, `HOLD`, `DENY`, validation, receipt determinism, and x402 readiness

## Judge Path

1. Open the live console.
2. Run **Routine transfer** and inspect the `ALLOW` receipt with risk `0`.
3. Run **Spend cap breach** and inspect the `HOLD` evidence.
4. Run **Unlimited approval** and inspect the `DENY` receipt with risk `100`.
5. Change any policy value and run again to see the receipt hash change.
6. Open the raw response or download the receipt JSON.

## Innovation

TxSentinel separates transaction capability from transaction authority. It does not merely simulate whether a call succeeds. It deterministically proves whether the action complies with a user or organization policy, while keeping the wallet in sole control of signing.

## Current Proof and Remaining Activation

The free API and policy console are live. The official x402 server integration is in the repository and exposes deployment readiness. A real x402 settlement requires OKX facilitator credentials, a receiving address, and a funded testnet payer; until those are configured, the product labels x402 as staged and makes no settlement claim.

## Award Fit

- **Best Product**: complete, judgeable workflow with receipts and downloadable evidence.
- **Finance Copilot**: pre-sign controls for transfers, swaps, approvals, and contract calls.
- **Software Utility**: reusable API boundary for any agent wallet or automation stack.
- **Revenue Rocket**: official x402 pay-per-check path ready for credential activation.
