const test = require("node:test");
const assert = require("node:assert/strict");
const preflightHandler = require("../api/preflight");
const legacyHandler = require("../api/check");
const { evaluateTransaction } = require("../lib/policy");

function invoke(handler, method, body = undefined) {
  return new Promise((resolve) => {
    const headers = {};
    const req = { method, body };
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, headers, body: payload }); },
      end() { resolve({ status: this.statusCode, headers, body: null }); }
    };
    handler(req, res);
  });
}

const scenarios = {
  READY: {
    chain: "xlayer",
    operation: "transfer",
    to: "0x0000000000000000000000000000000000000002",
    amountUsd: 25,
    policy: { maxSpendUsd: 100, requireSimulation: true },
    simulation: { status: "succeeded", estimatedFeeUsd: 0.01 }
  },
  REVIEW: {
    chain: "base",
    operation: "swap",
    to: "0x111111125421ca6dc452d289314280a0f8842a65",
    amountUsd: 850,
    policy: { maxSpendUsd: 500 },
    simulation: { status: "succeeded" }
  },
  BLOCKED: {
    chain: "ethereum",
    operation: "approval",
    to: "0xdead00000000000000000000000000000000beef",
    amountUsd: 0,
    approvalAmount: "unlimited",
    policy: { denyUnlimitedApprovals: true },
    simulation: { status: "succeeded" }
  }
};

test("GET publishes the limited preflight contract", async () => {
  const response = await invoke(preflightHandler, "GET");

  assert.equal(response.status, 200);
  assert.equal(response.body.endpoint, "/api/preflight");
  assert.equal(response.body.paidEndpoint, "/api/check-paid");
  assert.deepEqual(response.body.preflightStatuses, ["READY", "REVIEW", "BLOCKED"]);
  assert.equal(response.body.decisions, undefined);
});

test("free preflight returns coarse readiness without formal receipt material", async () => {
  for (const [expected, input] of Object.entries(scenarios)) {
    const response = await invoke(preflightHandler, "POST", input);
    assert.equal(response.status, 200);
    assert.equal(response.body.preflight.status, expected);
    assert.equal(response.body.preflight.formalDecision, false);
    assert.equal(response.body.preflight.receiptIssued, false);
    assert.equal(response.body.result, undefined);
    assert.equal(response.body.preflight.actionDigest, undefined);
    assert.equal(response.body.preflight.receiptHash, undefined);
  }
});

test("READY is not an alias for formal ALLOW", async () => {
  const input = {
    chain: "xlayer",
    operation: "contract_call",
    to: "0x0000000000000000000000000000000000000002",
    amountUsd: 1,
    policy: { requireVerifiedContract: true },
    simulation: { status: "succeeded", contractVerified: false }
  };
  const preflight = await invoke(preflightHandler, "POST", input);
  const formal = evaluateTransaction(input);

  assert.equal(preflight.body.preflight.status, "READY");
  assert.equal(formal.decision, "HOLD");
  assert.equal(preflight.body.result, undefined);
});

test("empty POST checks the documented sample without issuing a receipt", async () => {
  const response = await invoke(preflightHandler, "POST", {});

  assert.equal(response.status, 200);
  assert.equal(response.body.inputMode, "review-sample");
  assert.equal(response.body.preflight.status, "READY");
  assert.equal(response.body.result, undefined);
});

test("legacy /api/check remains a deprecated preflight alias", async () => {
  const response = await invoke(legacyHandler, "GET");

  assert.equal(response.status, 200);
  assert.equal(response.headers.Deprecation, "true");
  assert.equal(response.headers.Link, "</api/preflight>; rel=\"successor-version\"");
  assert.equal(response.body.endpoint, "/api/preflight");
  assert.equal(response.body.legacyAlias, "/api/check");
});

test("invalid preflight POST returns structured 422 issues", async () => {
  const response = await invoke(preflightHandler, "POST", { amountUsd: -5 });

  assert.equal(response.status, 422);
  assert.equal(response.body.error, "INVALID_POLICY_REQUEST");
  assert.ok(response.body.issues.length > 0);
});

test("unsupported methods return 405 with an Allow header", async () => {
  const response = await invoke(preflightHandler, "DELETE");

  assert.equal(response.status, 405);
  assert.equal(response.headers.Allow, "GET, POST, OPTIONS");
});
