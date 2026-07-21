# TxSentinel Verification Evidence

This record separates reproducible evidence from product claims. It contains no credentials,
private keys, or wallet signatures.

## 1. Live x402 settlement

| Field | Value |
| --- | --- |
| Explorer | [X Layer Testnet transaction](https://www.okx.com/web3/explorer/xlayer-test/tx/0x78865316d773400a223c0e76aced95c25def2fba3f0335b79ba64ff70354f68d) |
| Transaction hash | `0x78865316d773400a223c0e76aced95c25def2fba3f0335b79ba64ff70354f68d` |
| Chain | X Layer Testnet (`1952`, `0x7a0`) |
| Block / time | `36143837` / `2026-07-21T02:57:54.000Z` |
| Receipt status | `0x1` (success) |
| Call | EIP-3009 `transferWithAuthorization` |
| Token | test USD₮0 (`0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`) |
| Amount | `10000` atomic units (`0.01`, 6 decimals) |
| Authorized buyer | `0x0934146ca4f8e611da0ef8bd295ee9f7e34741fe` |
| Seller / live `payTo` | `0x4a6aae28b27681856ae824af82fea87896ecc3ed` |
| Facilitator relayer | `0x40817a0d9043732d48823c05ab2ffb643ef8d90a` |

## 2. Why this is the TxSentinel payment

The live `POST https://txsentinel-okx.vercel.app/api/check-paid` endpoint returns HTTP `402` and an
x402 v2 `PAYMENT-REQUIRED` challenge. Its test USD₮0 option specifies all four values below:

1. Network: `eip155:1952`
2. Asset: `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`
3. Amount: `10000`
4. `payTo`: `0x4a6aae28b27681856ae824af82fea87896ecc3ed`

The successful transaction and its ERC-20 `Transfer` event match all four values. The input also
contains the authorized buyer, recipient, amount, validity window, nonce, and buyer signature used by
the EIP-3009 flow. The facilitator relayer submitting the transaction instead of the buyer is expected:
the buyer signs a request-bound authorization, while the facilitator verifies, settles, and pays gas.

## 3. Reproduce the chain check

Use the official X Layer Testnet RPC without any API credentials:

```bash
curl -sS https://xlayertestrpc.okx.com/terigon \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0x78865316d773400a223c0e76aced95c25def2fba3f0335b79ba64ff70354f68d"]}'
```

The receipt must have `status: "0x1"`. Its token `Transfer` log contains:

- topic 0: ERC-20 `Transfer(address,address,uint256)`
- topic 1: authorized buyer
- topic 2: seller / `payTo`
- data: `0x2710`, which is `10000` atomic units

## 4. Other public evidence

- Live product: <https://txsentinel-okx.vercel.app>
- Buyer settlement lab: <https://txsentinel-okx.vercel.app/integrate.html>
- Formal paid endpoint: <https://txsentinel-okx.vercel.app/api/check-paid>
- Canonical policy anchor deployment: [X Layer Testnet transaction](https://www.okx.com/web3/explorer/xlayer-test/tx/0x6604803fda9b0b298ed18ea1e3e9dfc4b58b05e0f2989652f64500e8aa741ae9)
