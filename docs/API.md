# API Contract

## Free Policy Check

`POST /api/check`

```json
{
  "chain": "xlayer",
  "operation": "transfer",
  "to": "0x4a6aae28b27681856ae824af82fea87896ecc3ed",
  "amountUsd": 25,
  "policy": {
    "maxSpendUsd": 100,
    "allowlistedRecipients": [],
    "blockedRecipients": [],
    "denyUnlimitedApprovals": true,
    "requireSimulation": true,
    "requireVerifiedContract": false,
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

Successful responses use HTTP 200 even when the policy decision is `HOLD` or `DENY`. Those are valid policy outcomes, not transport errors.

Invalid request schemas return HTTP 422:

```json
{
  "ok": false,
  "error": "INVALID_POLICY_REQUEST",
  "issues": [
    { "path": "amountUsd", "code": "too_small", "message": "Number must be greater than or equal to 0" }
  ]
}
```

## Paid Policy Check

`POST /api/check-paid` accepts the same JSON body. When configured, the endpoint follows x402 v2:

1. Request without payment returns HTTP 402 and `PAYMENT-REQUIRED`.
2. The payer retries with `PAYMENT-SIGNATURE`.
3. The facilitator verifies and settles on X Layer.
4. The server returns HTTP 200, the policy receipt, and `PAYMENT-RESPONSE`.

`GET /api/check-paid` returns the current protocol readiness without requiring payment.

## Receipt Stability

`evaluatedAt` is intentionally outside `result`. Repeating an equivalent normalized request produces the same `result.actionDigest` and `result.receiptHash` even though the HTTP timestamp changes.
