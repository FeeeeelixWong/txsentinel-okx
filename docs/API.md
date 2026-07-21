# API Contract

All policy endpoints accept the same proposed action, policy, and supplied evidence shape. They
differ intentionally in what they return and whether a payment is required.

## 1. Free Readiness Preflight

`POST /api/preflight`

```json
{
  "chain": "xlayer",
  "operation": "transfer",
  "to": "0x4a6aae28b27681856ae824af82fea87896ecc3ed",
  "amountUsd": 25,
  "policy": {
    "maxSpendUsd": 100,
    "denyUnlimitedApprovals": true,
    "requireSimulation": true,
    "maxSlippageBps": 100,
    "maxFeeUsd": 5
  },
  "simulation": {
    "status": "succeeded",
    "estimatedFeeUsd": 0.01,
    "slippageBps": 0,
    "contractVerified": false
  }
}
```

The free response is deliberately non-binding and coarse. It applies only lightweight readiness
screening, not the complete formal rule set:

```json
{
  "ok": true,
  "mode": "preflight",
  "checkedAt": "2026-07-21T00:00:00.000Z",
  "preflight": {
    "status": "READY",
    "billing": "free",
    "binding": false,
    "formalDecision": false,
    "receiptIssued": false,
    "next": {
      "action": "REQUEST_PAID_CHECK",
      "endpoint": "/api/check-paid"
    }
  }
}
```

Possible statuses are:

| Status | Meaning | Formal evidence? |
| --- | --- | --- |
| `READY` | Basic screening passed; the formal result may still be `ALLOW`, `HOLD`, or `DENY` | No |
| `REVIEW` | Human review is advisable before continuing | No |
| `BLOCKED` | Stop or purchase a detailed report for the exact reason | No |

Preflight checks request shape, supported chains and operations, obvious reverts, unlimited approvals,
recipient presence, spend readiness, and required simulation presence. The formal route additionally
evaluates recipient lists, contract verification, slippage, fees, and the complete normalized policy.
Preflight never returns `ALLOW`, `HOLD`, or `DENY`, detailed rule evidence, risk score,
`actionDigest`, or `receiptHash`. `READY` is not an alias for `ALLOW` and is not authorization to sign
or execute an action.

`GET /api/preflight` publishes the machine-readable contract. The original `GET/POST /api/check`
URL remains a deprecated alias and sends `Deprecation: true` plus a successor `Link` header so the
existing ASP review URL keeps working.

## 2. Formal Paid Policy Check

`POST /api/check-paid` accepts the same JSON body and follows x402 v2:

1. TxSentinel validates and deterministically evaluates the request offchain before payment.
2. Invalid schemas return HTTP `422`; no `PAYMENT-REQUIRED` header or settlement is created.
3. A valid request without payment returns HTTP `402` and `PAYMENT-REQUIRED`.
4. The payer retries with `PAYMENT-SIGNATURE` after explicit OKX Wallet approval.
5. The facilitator verifies and settles the service fee on X Layer.
6. The server returns HTTP `200`, the formal policy result, and `PAYMENT-RESPONSE`.

The paid `result` includes the formal `ALLOW`, `HOLD`, or `DENY` decision, normalized action,
policy snapshot, evidence, detailed reasons, risk score, `actionDigest`, and deterministic
`receiptHash`.

`GET /api/check-paid` returns protocol readiness and accepted assets without requiring payment.

## 3. Invalid Request Response

Both preflight and formal endpoints reject malformed input before issuing useful output. On the
paid route this rejection occurs before the x402 middleware:

```json
{
  "ok": false,
  "error": "INVALID_POLICY_REQUEST",
  "issues": [
    { "path": "amountUsd", "code": "too_small", "message": "Number must be greater than or equal to 0" }
  ]
}
```

## 4. Receipt Stability

`evaluatedAt` is outside the paid `result`. Repeating an equivalent normalized formal request
produces the same `result.actionDigest` and `result.receiptHash`, even though the HTTP timestamp
changes. Free preflight does not expose either hash.
