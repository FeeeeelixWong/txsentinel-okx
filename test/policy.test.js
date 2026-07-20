const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateTransaction, validateTransaction } = require("../lib/policy");

function reasonCodes(result) {
  return result.reasons.map((reason) => reason.code);
}

test("allows an action inside policy bounds", () => {
  const result = evaluateTransaction({
    chain: "xlayer",
    to: "0xabc",
    amountUsd: 25,
    policy: { maxSpendUsd: 100 }
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.riskScore, 0);
  assert.equal(result.deterministic, true);
});

test("holds an action above the spend limit", () => {
  const result = evaluateTransaction({ chain: "base", to: "0xabc", amountUsd: 125, policy: { maxSpendUsd: 100 } });

  assert.equal(result.decision, "HOLD");
  assert.ok(reasonCodes(result).includes("SPEND_LIMIT_EXCEEDED"));
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
  assert.ok(reasonCodes(result).includes("UNLIMITED_APPROVAL"));
});

test("denies unsupported chains and operations", () => {
  const result = evaluateTransaction({ chain: "unknown", operation: "bridge", to: "recipient", amountUsd: 1 });

  assert.equal(result.decision, "DENY");
  assert.deepEqual(reasonCodes(result).slice(0, 2), ["UNSUPPORTED_CHAIN", "UNSUPPORTED_OPERATION"]);
});

test("denies recipients on the explicit blocklist", () => {
  const result = evaluateTransaction({
    chain: "base",
    to: "0xBad",
    amountUsd: 1,
    policy: { blockedRecipients: ["0xbad"] }
  });

  assert.equal(result.decision, "DENY");
  assert.ok(reasonCodes(result).includes("RECIPIENT_BLOCKED"));
});

test("denies a supplied simulation revert", () => {
  const result = evaluateTransaction({
    chain: "xlayer",
    to: "0xabc",
    amountUsd: 1,
    simulation: { status: "reverted", reason: "execution reverted" }
  });

  assert.equal(result.decision, "DENY");
  assert.ok(reasonCodes(result).includes("SIMULATION_REVERTED"));
});

test("holds when required simulation evidence is absent", () => {
  const result = evaluateTransaction({
    chain: "base",
    to: "0xabc",
    amountUsd: 1,
    policy: { requireSimulation: true }
  });

  assert.equal(result.decision, "HOLD");
  assert.ok(reasonCodes(result).includes("SIMULATION_REQUIRED"));
});

test("holds an unverified contract call", () => {
  const result = evaluateTransaction({
    chain: "xlayer",
    operation: "contract_call",
    to: "0xabc",
    amountUsd: 1,
    policy: { requireVerifiedContract: true },
    simulation: { status: "succeeded", contractVerified: false }
  });

  assert.equal(result.decision, "HOLD");
  assert.ok(reasonCodes(result).includes("CONTRACT_NOT_VERIFIED"));
});

test("holds excessive swap slippage", () => {
  const result = evaluateTransaction({
    chain: "base",
    operation: "swap",
    to: "0xabc",
    amountUsd: 50,
    policy: { maxSlippageBps: 50 },
    simulation: { status: "succeeded", slippageBps: 75 }
  });

  assert.equal(result.decision, "HOLD");
  assert.ok(reasonCodes(result).includes("SLIPPAGE_LIMIT_EXCEEDED"));
});

test("holds an excessive estimated fee", () => {
  const result = evaluateTransaction({
    chain: "ethereum",
    to: "0xabc",
    amountUsd: 10,
    policy: { maxFeeUsd: 2 },
    simulation: { status: "succeeded", estimatedFeeUsd: 3.5 }
  });

  assert.equal(result.decision, "HOLD");
  assert.ok(reasonCodes(result).includes("FEE_LIMIT_EXCEEDED"));
});

test("holds a recipient outside a non-empty allowlist", () => {
  const result = evaluateTransaction({
    chain: "xlayer",
    to: "0xdef",
    amountUsd: 10,
    policy: { allowlistedRecipients: ["0xabc"] }
  });

  assert.equal(result.decision, "HOLD");
  assert.ok(reasonCodes(result).includes("RECIPIENT_NOT_ALLOWLISTED"));
});

test("normalizes EVM identities but preserves Solana case", () => {
  const evm = evaluateTransaction({ chain: "base", to: "0xAbC", amountUsd: 1 });
  const solana = evaluateTransaction({ chain: "solana", to: "AbCDef", amountUsd: 1 });

  assert.equal(evm.action.to, "0xabc");
  assert.equal(solana.action.to, "AbCDef");
});

test("produces the same receipt for equivalent normalized input", () => {
  const first = evaluateTransaction({ chain: "XLAYER", to: "0xAbC", amountUsd: 10, policy: { maxSpendUsd: 100 } });
  const second = evaluateTransaction({ policy: { maxSpendUsd: 100 }, amountUsd: 10, to: "0xabc", chain: "xlayer" });

  assert.equal(first.actionDigest, second.actionDigest);
  assert.equal(first.receiptHash, second.receiptHash);
});

test("rejects unknown request fields", () => {
  const validation = validateTransaction({ chain: "xlayer", to: "0xabc", secretKey: "must-not-be-accepted" });

  assert.equal(validation.success, false);
  assert.ok(validation.issues.some((issue) => issue.code === "unrecognized_keys"));
});

test("rejects negative monetary values before policy evaluation", () => {
  const validation = validateTransaction({ chain: "xlayer", amountUsd: -1 });

  assert.equal(validation.success, false);
  assert.ok(validation.issues.some((issue) => issue.path === "amountUsd"));
});
