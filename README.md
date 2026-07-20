# TxSentinel

TxSentinel is an agent-native transaction policy firewall. It evaluates a proposed onchain action before signing and returns a deterministic `ALLOW`, `HOLD`, or `DENY` decision with structured reasons and a receipt hash.

## API

`POST /api/check`

```json
{
  "chain": "xlayer",
  "operation": "transfer",
  "from": "0x...",
  "to": "0x...",
  "amountUsd": 25,
  "policy": {
    "maxSpendUsd": 100,
    "allowlistedRecipients": [],
    "denyUnlimitedApprovals": true
  }
}
```

The endpoint also accepts an empty POST request and evaluates a documented review sample, allowing marketplace reviewers to verify availability immediately.

## Current Scope

- Deterministic policy evaluation
- Spend limits and recipient allowlists
- Unlimited approval blocking
- Simulation-result enforcement when supplied
- Stable SHA-256 receipt generation
- X Layer, Ethereum, Base and Solana identifiers

The current listing candidate is a free API service. Official pay-per-call settlement and live transaction simulation are the next implementation milestones.

## Development

```bash
npm test
npm run check
```

## Security

TxSentinel is read-only. It does not request, store, or use wallet private keys and cannot sign or broadcast transactions.

