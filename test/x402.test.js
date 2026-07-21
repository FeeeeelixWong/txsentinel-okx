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
  process.env.X402_PRICE = "$0.01";
  process.env.OKX_X402_BASE_URL = `http://127.0.0.1:${facilitatorPort}`;

  const app = require("../api/check-paid");
  assert.equal(app.resolveFacilitatorBaseUrl({}), "https://web3.okx.com");
  assert.equal(
    app.resolveFacilitatorBaseUrl({ OKX_X402_BASE_URL: `http://127.0.0.1:${facilitatorPort}` }),
    `http://127.0.0.1:${facilitatorPort}`
  );
  let discoveryAttempts = 0;
  const supported = await app.retrySupportedDiscovery(
    async () => {
      discoveryAttempts += 1;
      if (discoveryAttempts < 3) throw new Error("temporary discovery failure");
      return { kinds: ["exact"] };
    },
    { attempts: 3, wait: async () => {} }
  );
  assert.deepEqual(supported, { kinds: ["exact"] });
  assert.equal(discoveryAttempts, 3);
  assert.equal(app.priceToAtomicUnits("$0.01"), "10000");
  assert.equal(app.priceToAtomicUnits("1"), "1000000");
  assert.throws(() => app.priceToAtomicUnits("0.0000001"), /at most 6 decimal places/);
  const options = app.buildPaymentOptions(payTo, "$0.01");
  assert.deepEqual(options.map((option) => option.price.extra.symbol), ["test USD₮0", "test USDG", "test USDC"]);
  assert.deepEqual(options.map((option) => option.price.amount), ["10000", "10000", "10000"]);
  assert.deepEqual(options.map((option) => option.price.asset), [
    "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
    "0xa78e2baabaf5c4f36b7fc394725deb68d332eec1",
    "0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d"
  ]);
  const resource = http.createServer(app);
  const resourcePort = await listen(resource);

  try {
    const invalid = await fetch(`http://127.0.0.1:${resourcePort}/api/check-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
      body: JSON.stringify({ amountUsd: -1 })
    });
    const invalidBody = await invalid.json();
    assert.equal(invalid.status, 422);
    assert.equal(invalidBody.error, "INVALID_POLICY_REQUEST");
    assert.match(invalidBody.message, /before any x402 payment/i);
    assert.equal(invalid.headers.get("payment-required"), null);

    const response = await fetch(`http://127.0.0.1:${resourcePort}/api/check-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
      body: JSON.stringify({ chain: "xlayer", to: "0xabc", amountUsd: 1 })
    });
    const encoded = response.headers.get("payment-required");

    assert.equal(response.status, 402);
    assert.ok(encoded);
    const requirement = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    assert.equal(requirement.x402Version, 2);
    assert.match(requirement.resource.url, /^https:\/\//);
    assert.equal(requirement.accepts.length, 3);
    assert.deepEqual(requirement.accepts.map((option) => option.extra.symbol), ["test USD₮0", "test USDG", "test USDC"]);
    assert.ok(requirement.accepts.every((option) => option.network === "eip155:1952"));
    assert.ok(requirement.accepts.every((option) => option.scheme === "exact"));
    assert.ok(requirement.accepts.every((option) => option.amount === "10000"));
    assert.ok(requirement.accepts.every((option) => option.payTo === payTo));
  } finally {
    await close(resource);
    await close(facilitator);
  }
});
