const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");

const payTo = "0x4a6aae28b27681856ae824af82fea87896ecc3ed";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("official OKX middleware emits a standard unpaid 402 challenge", async () => {
  const facilitator = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.includes("/supported")) {
      return res.end(JSON.stringify({
        data: {
          kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:1952", extra: {} }],
          extensions: [],
          signers: {}
        }
      }));
    }
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "unexpected facilitator request" }));
  });
  const facilitatorPort = await listen(facilitator);

  process.env.OKX_API_KEY = "test-key";
  process.env.OKX_SECRET_KEY = "test-secret";
  process.env.OKX_PASSPHRASE = "test-passphrase";
  process.env.PAY_TO_ADDRESS = payTo;
  process.env.X402_NETWORK = "eip155:1952";
  process.env.X402_PRICE = "$0.01";
  process.env.OKX_X402_BASE_URL = `http://127.0.0.1:${facilitatorPort}`;

  const app = require("../api/check-paid");
  assert.equal(app.resolveFacilitatorBaseUrl({}), "https://web3.okx.com");
  assert.equal(
    app.resolveFacilitatorBaseUrl({ OKX_X402_BASE_URL: `http://127.0.0.1:${facilitatorPort}` }),
    `http://127.0.0.1:${facilitatorPort}`
  );
  const resource = http.createServer(app);
  const resourcePort = await listen(resource);

  try {
    const response = await fetch(`http://127.0.0.1:${resourcePort}/api/check-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chain: "xlayer", to: "0xabc", amountUsd: 1 })
    });
    const encoded = response.headers.get("payment-required");

    assert.equal(response.status, 402);
    assert.ok(encoded);
    const requirement = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    assert.equal(requirement.x402Version, 2);
    assert.equal(requirement.accepts[0].scheme, "exact");
    assert.equal(requirement.accepts[0].network, "eip155:1952");
    assert.equal(requirement.accepts[0].amount, "10000");
    assert.equal(requirement.accepts[0].payTo, payTo);
  } finally {
    await close(resource);
    await close(facilitator);
  }
});
