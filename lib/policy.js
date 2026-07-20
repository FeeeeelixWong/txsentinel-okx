const crypto = require("node:crypto");

const SUPPORTED_CHAINS = new Set(["xlayer", "ethereum", "base", "solana"]);
const DECISION_RANK = { ALLOW: 0, HOLD: 1, DENY: 2 };

function normalizeAddress(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function highestDecision(current, candidate) {
  return DECISION_RANK[candidate] > DECISION_RANK[current] ? candidate : current;
}

function evaluateTransaction(input = {}) {
  const chain = String(input.chain || "xlayer").toLowerCase();
  const operation = String(input.operation || "transfer").toLowerCase();
  const amountUsd = Number(input.amountUsd ?? 0);
  const recipient = normalizeAddress(input.to);
  const policy = input.policy && typeof input.policy === "object" ? input.policy : {};
  const maxSpendUsd = Number(policy.maxSpendUsd ?? 1000);
  const allowlist = Array.isArray(policy.allowlistedRecipients)
    ? policy.allowlistedRecipients.map(normalizeAddress).filter(Boolean)
    : [];
  const reasons = [];
  let decision = "ALLOW";

  if (!SUPPORTED_CHAINS.has(chain)) {
    decision = "DENY";
    reasons.push({ code: "UNSUPPORTED_CHAIN", severity: "critical", detail: `${chain} is not supported` });
  }

  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    decision = "DENY";
    reasons.push({ code: "INVALID_AMOUNT", severity: "critical", detail: "amountUsd must be a non-negative number" });
  }

  if (input.simulation && input.simulation.status === "reverted") {
    decision = "DENY";
    reasons.push({ code: "SIMULATION_REVERTED", severity: "critical", detail: input.simulation.reason || "Transaction simulation reverted" });
  }

  if (operation === "approval" && policy.denyUnlimitedApprovals !== false && input.approvalAmount === "unlimited") {
    decision = "DENY";
    reasons.push({ code: "UNLIMITED_APPROVAL", severity: "critical", detail: "Unlimited token approval violates policy" });
  }

  if (Number.isFinite(amountUsd) && Number.isFinite(maxSpendUsd) && amountUsd > maxSpendUsd) {
    decision = highestDecision(decision, "HOLD");
    reasons.push({ code: "SPEND_LIMIT_EXCEEDED", severity: "high", detail: `${amountUsd} USD exceeds the ${maxSpendUsd} USD policy limit` });
  }

  if (allowlist.length > 0 && recipient && !allowlist.includes(recipient)) {
    decision = highestDecision(decision, "HOLD");
    reasons.push({ code: "RECIPIENT_NOT_ALLOWLISTED", severity: "high", detail: "Recipient requires manual approval" });
  }

  if (!recipient) {
    decision = highestDecision(decision, "HOLD");
    reasons.push({ code: "RECIPIENT_MISSING", severity: "medium", detail: "No recipient was supplied" });
  }

  if (reasons.length === 0) {
    reasons.push({ code: "POLICY_CHECKS_PASSED", severity: "info", detail: "The proposed action satisfies the supplied policy" });
  }

  const evaluated = {
    version: "2026-07-20",
    chain,
    operation,
    from: normalizeAddress(input.from),
    to: recipient,
    amountUsd: Number.isFinite(amountUsd) ? amountUsd : null,
    policy: {
      maxSpendUsd: Number.isFinite(maxSpendUsd) ? maxSpendUsd : null,
      allowlistedRecipients: allowlist,
      denyUnlimitedApprovals: policy.denyUnlimitedApprovals !== false
    },
    decision,
    reasons
  };

  const receiptHash = `0x${crypto.createHash("sha256").update(stableStringify(evaluated)).digest("hex")}`;

  return {
    service: "TxSentinel Transaction Policy Check",
    ...evaluated,
    receiptHash,
    deterministic: true
  };
}

module.exports = { evaluateTransaction, stableStringify };

