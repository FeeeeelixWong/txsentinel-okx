const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateTransaction } = require("../lib/policy");

test("allows an action inside policy bounds", () => {
  const result = evaluateTransaction({
    chain: "xlayer",
    to: "0xabc",
    amountUsd: 25,
    policy: { maxSpendUsd: 100 }
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.deterministic, true);
});

test("holds an action above the spend limit", () => {
  const result = evaluateTransaction({
    chain: "base",
    to: "0xabc",
    amountUsd: 125,
    policy: { maxSpendUsd: 100 }
  });

  assert.equal(result.decision, "HOLD");
  assert.equal(result.reasons[0].code, "SPEND_LIMIT_EXCEEDED");
});

test("denies an unlimited approval", () => {
  const result = evaluateTransaction({
    chain: "ethereum",
    operation: "approval",
    to: "0xabc",
    approvalAmount: "unlimited",
    policy: { denyUnlimitedApprovals: true }
  });

  assert.equal(result.decision, "DENY");
  assert.equal(result.reasons[0].code, "UNLIMITED_APPROVAL");
});

test("produces the same receipt for the same normalized input", () => {
  const input = {
    chain: "XLAYER",
    to: "0xAbC",
    amountUsd: 10,
    policy: { maxSpendUsd: 100 }
  };

  assert.equal(evaluateTransaction(input).receiptHash, evaluateTransaction(input).receiptHash);
});

