import assert from "node:assert/strict";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:8791").replace(/\/$/, "");

const scenarios = {
  allow: {
    chain: "xlayer",
    operation: "transfer",
    to: "0x4a6aae28b27681856ae824af82fea87896ecc3ed",
    amountUsd: 25,
    policy: { maxSpendUsd: 100, requireSimulation: true },
    simulation: { status: "succeeded", estimatedFeeUsd: 0.01 }
  },
  hold: {
    chain: "base",
    operation: "swap",
    to: "0x111111125421ca6dc452d289314280a0f8842a65",
    amountUsd: 850,
    policy: { maxSpendUsd: 500, maxSlippageBps: 100 },
    simulation: { status: "succeeded", slippageBps: 45 }
  },
  deny: {
    chain: "ethereum",
    operation: "approval",
    to: "0xdead00000000000000000000000000000000beef",
    amountUsd: 0,
    approvalAmount: "unlimited",
    policy: { denyUnlimitedApprovals: true },
    simulation: { status: "succeeded" }
  }
};

async function jsonRequest(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function evaluate(payload) {
  return jsonRequest("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

const health = await jsonRequest("/api/health");
assert.equal(health.response.status, 200);
assert.equal(health.body.status, "ready");

for (const [name, payload] of Object.entries(scenarios)) {
  const { response, body } = await evaluate(payload);
  assert.equal(response.status, 200, `${name} must return HTTP 200`);
  assert.equal(body.result.decision, name.toUpperCase());
  assert.match(body.result.actionDigest, /^0x[0-9a-f]{64}$/);
  assert.match(body.result.receiptHash, /^0x[0-9a-f]{64}$/);
  console.log(`${name.toUpperCase()} ${body.result.riskScore}/100 ${body.result.receiptHash}`);
}

const first = await evaluate(scenarios.allow);
const second = await evaluate(scenarios.allow);
assert.equal(first.body.result.receiptHash, second.body.result.receiptHash, "receipt must be deterministic");

const invalid = await evaluate({ amountUsd: -1 });
assert.equal(invalid.response.status, 422);
assert.equal(invalid.body.error, "INVALID_POLICY_REQUEST");

const x402 = await jsonRequest("/api/check-paid");
assert.equal(x402.response.status, 200);
assert.ok(["ready", "configuration_required"].includes(x402.body.status));

if (x402.body.status === "ready") {
  const unpaid = await evaluatePaid(scenarios.allow);
  assert.equal(unpaid.response.status, 402);
  assert.ok(unpaid.response.headers.get("payment-required"), "402 must expose PAYMENT-REQUIRED");
  console.log("X402 READY unpaid challenge verified");
} else {
  const staged = await evaluatePaid(scenarios.allow);
  assert.equal(staged.response.status, 503);
  assert.equal(staged.body.error, "X402_CONFIGURATION_REQUIRED");
  console.log(`X402 STAGED missing ${x402.body.missing.join(", ")}`);
}

console.log(`Smoke passed against ${baseUrl}`);

async function evaluatePaid(payload) {
  return jsonRequest("/api/check-paid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
