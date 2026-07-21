# TxSentinel Hackathon Submission

## One-Line Pitch

TxSentinel is a deterministic transaction policy firewall that gives autonomous agents an explainable `ALLOW`, `HOLD`, or `DENY` receipt before signing.

## Problem

Agentic wallets can plan, pay, trade, and interact with contracts, but a transaction that is technically executable may still violate the user's mandate. Spend caps, approved recipients, approval scope, simulation results, fee limits, and contract trust are usually scattered across application code and are difficult to audit after the fact.

## Product

TxSentinel turns those constraints into two deliberate pre-sign surfaces. A free preflight returns only coarse `READY`, `REVIEW`, or `BLOCKED` routing. When formal evidence is needed, the x402 route validates before payment and then returns a normalized policy snapshot, risk score, structured evidence, action digest, and deterministic receipt hash after settlement. Hard violations are denied, ambiguous cases are held for review, and compliant actions are allowed.

## Why OKX

- X Layer is a first-class supported chain and is the default product scenario.
- TxSentinel is registered as an OKX ASP candidate, agent `#6828`.
- The paid route integrates the official OKX x402 Node packages and isolates payment settlement from policy logic.
- The design complements Agentic Wallet: the wallet remains the signer while TxSentinel acts as a read-only authorization boundary.

## What Is Live

- Interactive console: https://txsentinel-okx.vercel.app
- Free readiness preflight: https://txsentinel-okx.vercel.app/api/preflight
- Formal x402 policy API: https://txsentinel-okx.vercel.app/api/check-paid
- Source: https://github.com/FeeeeelixWong/txsentinel-okx
- Verified x402 settlement: https://www.okx.com/web3/explorer/xlayer-test/tx/0x78865316d773400a223c0e76aced95c25def2fba3f0335b79ba64ff70354f68d
- 30 automated policy, preflight, contract, HTTP, and official x402 middleware tests
- Deployment smoke for `READY`, `REVIEW`, `BLOCKED`, prepayment validation, and x402 readiness

## Judge Path

1. Open the free preflight console.
2. Run **Routine transfer** and inspect `READY` without any formal receipt material.
3. Run **Spend cap breach** and inspect `REVIEW`.
4. Run **Unlimited approval** and inspect `BLOCKED`.
5. Open Integrate, load the live 402 terms, and complete the formal flow with OKX Wallet.
6. Inspect the paid `ALLOW`, `HOLD`, or `DENY` result, deterministic hashes, and settlement proof.

## Innovation

TxSentinel separates transaction capability from transaction authority. It does not merely simulate whether a call succeeds. It deterministically proves whether the action complies with a user or organization policy, while keeping the wallet in sole control of signing.

## Current Proof

The free preflight and formal x402 API are live. Invalid formal requests fail before payment. Valid
requests receive official OKX x402 terms. A buyer completed the browser flow with OKX Wallet, and the
official facilitator settled `0.01` test USD₮0 on X Layer Testnet. The successful transaction's token,
amount, buyer, and seller match the live 402 challenge exactly. See [EVIDENCE.md](./EVIDENCE.md).

## Award Fit

- **Best Product**: complete, judgeable workflow with verifiable paid receipts and optional X Layer anchoring.
- **Finance Copilot**: pre-sign controls for transfers, swaps, approvals, and contract calls.
- **Software Utility**: reusable API boundary for any agent wallet or automation stack.
- **Revenue Rocket**: live official x402 pay-per-check path with three accepted X Layer test assets.
