const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/check");

function invoke(method, body = undefined) {
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

test("GET publishes the review contract", async () => {
  const response = await invoke("GET");

  assert.equal(response.status, 200);
  assert.equal(response.body.endpoint, "/api/check");
  assert.equal(response.body.paidEndpoint, "/api/check-paid");
  assert.deepEqual(response.body.decisions, ["ALLOW", "HOLD", "DENY"]);
});

test("empty POST evaluates the documented review sample", async () => {
  const response = await invoke("POST", {});

  assert.equal(response.status, 200);
  assert.equal(response.body.inputMode, "review-sample");
  assert.equal(response.body.result.decision, "ALLOW");
  assert.match(response.body.result.receiptHash, /^0x[0-9a-f]{64}$/);
});

test("invalid POST returns structured 422 issues", async () => {
  const response = await invoke("POST", { amountUsd: -5 });

  assert.equal(response.status, 422);
  assert.equal(response.body.error, "INVALID_POLICY_REQUEST");
  assert.ok(response.body.issues.length > 0);
});

test("unsupported methods return 405 with an Allow header", async () => {
  const response = await invoke("DELETE");

  assert.equal(response.status, 405);
  assert.equal(response.headers.Allow, "GET, POST, OPTIONS");
});
