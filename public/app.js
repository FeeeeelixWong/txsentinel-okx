const scenarios = {
  safe: {
    chain: "xlayer",
    operation: "transfer",
    to: "0x4a6aae28b27681856ae824af82fea87896ecc3ed",
    amount: 25,
    maxSpend: 100,
    maxSlippage: 100,
    maxFee: 5,
    allowlist: "",
    denyUnlimited: true,
    requireSimulation: true,
    requireVerified: false,
    simulationStatus: "succeeded",
    estimatedFee: 0.01,
    slippage: 0,
    contractVerified: false
  },
  hold: {
    chain: "base",
    operation: "swap",
    to: "0x111111125421ca6dc452d289314280a0f8842a65",
    amount: 850,
    maxSpend: 500,
    maxSlippage: 100,
    maxFee: 15,
    allowlist: "",
    denyUnlimited: true,
    requireSimulation: true,
    requireVerified: true,
    simulationStatus: "succeeded",
    estimatedFee: 0.42,
    slippage: 45,
    contractVerified: true
  },
  deny: {
    chain: "ethereum",
    operation: "approval",
    to: "0xdead00000000000000000000000000000000beef",
    amount: 0,
    approval: "unlimited",
    maxSpend: 1000,
    maxSlippage: 100,
    maxFee: 25,
    allowlist: "",
    denyUnlimited: true,
    requireSimulation: true,
    requireVerified: true,
    simulationStatus: "succeeded",
    estimatedFee: 4.8,
    slippage: 0,
    contractVerified: true
  }
};

const byId = (id) => document.getElementById(id);
const form = byId("policy-form");
const evaluateButton = byId("evaluate");
let latestResponse = null;

function setValue(id, value) {
  const element = byId(id);
  if (element.type === "checkbox") element.checked = Boolean(value);
  else element.value = value ?? "";
}

function loadScenario(name) {
  const scenario = scenarios[name];
  setValue("chain", scenario.chain);
  setValue("operation", scenario.operation);
  setValue("to", scenario.to);
  setValue("amount", scenario.amount);
  setValue("approval", scenario.approval || "unlimited");
  setValue("max-spend", scenario.maxSpend);
  setValue("max-slippage", scenario.maxSlippage);
  setValue("max-fee", scenario.maxFee);
  setValue("allowlist", scenario.allowlist);
  setValue("deny-unlimited", scenario.denyUnlimited);
  setValue("require-simulation", scenario.requireSimulation);
  setValue("require-verified", scenario.requireVerified);
  setValue("simulation-status", scenario.simulationStatus);
  setValue("estimated-fee", scenario.estimatedFee);
  setValue("slippage", scenario.slippage);
  setValue("contract-verified", scenario.contractVerified);
  updateOperationFields();

  document.querySelectorAll(".scenario-tab").forEach((tab) => {
    const active = tab.dataset.scenario === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
}

function updateOperationFields() {
  byId("approval-field").classList.toggle("hidden", byId("operation").value !== "approval");
}

function numberValue(id) {
  const value = Number(byId(id).value);
  return Number.isFinite(value) ? value : 0;
}

function requestPayload() {
  const operation = byId("operation").value;
  const payload = {
    chain: byId("chain").value,
    operation,
    to: byId("to").value.trim(),
    amountUsd: numberValue("amount"),
    policy: {
      maxSpendUsd: numberValue("max-spend"),
      allowlistedRecipients: byId("allowlist").value.split(",").map((value) => value.trim()).filter(Boolean),
      denyUnlimitedApprovals: byId("deny-unlimited").checked,
      requireSimulation: byId("require-simulation").checked,
      requireVerifiedContract: byId("require-verified").checked,
      maxSlippageBps: numberValue("max-slippage"),
      maxFeeUsd: numberValue("max-fee")
    },
    simulation: {
      status: byId("simulation-status").value,
      estimatedFeeUsd: numberValue("estimated-fee"),
      slippageBps: numberValue("slippage"),
      contractVerified: byId("contract-verified").checked
    }
  };

  if (operation === "approval") {
    const approval = byId("approval").value;
    payload.approvalAmount = approval === "unlimited" ? approval : Number(approval);
  }

  return payload;
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 12)}...${hash.slice(-10)}` : "-";
}

function renderReceipt(response) {
  latestResponse = response;
  const result = response.result;
  const decision = result.decision.toLowerCase();
  const badge = byId("decision-badge");
  badge.textContent = result.decision;
  badge.className = `decision-badge ${decision}`;
  byId("empty-receipt").classList.add("hidden");
  byId("error-panel").classList.add("hidden");
  byId("receipt-content").classList.remove("hidden");
  byId("risk-value").textContent = result.riskScore;
  const riskBar = byId("risk-bar");
  riskBar.style.width = `${result.riskScore}%`;
  riskBar.style.background = result.riskScore >= 100 ? "var(--red)" : result.riskScore >= 60 ? "var(--amber)" : "var(--lime)";
  byId("policy-version").textContent = result.policyVersion;
  byId("action-digest").textContent = shortHash(result.actionDigest);
  byId("action-digest").title = result.actionDigest;
  byId("receipt-hash").textContent = shortHash(result.receiptHash);
  byId("receipt-hash").title = result.receiptHash;
  byId("evaluated-at").textContent = new Date(response.evaluatedAt).toLocaleTimeString();
  byId("raw-response").textContent = JSON.stringify(response, null, 2);

  const reasonList = byId("reason-list");
  reasonList.replaceChildren();
  result.reasons.forEach((reason) => {
    const row = document.createElement("div");
    row.className = `reason-row ${reason.severity}`;
    const dot = document.createElement("i");
    dot.className = "reason-dot";
    const content = document.createElement("div");
    const code = document.createElement("strong");
    code.textContent = reason.code;
    const detail = document.createElement("p");
    detail.textContent = reason.detail;
    const severity = document.createElement("em");
    severity.textContent = reason.severity;
    content.append(code, detail);
    row.append(dot, content, severity);
    reasonList.append(row);
  });
}

function renderError(message) {
  byId("empty-receipt").classList.add("hidden");
  byId("receipt-content").classList.add("hidden");
  byId("error-panel").classList.remove("hidden");
  byId("error-message").textContent = message;
  const badge = byId("decision-badge");
  badge.textContent = "ERROR";
  badge.className = "decision-badge deny";
}

async function evaluate(event) {
  event.preventDefault();
  evaluateButton.disabled = true;
  evaluateButton.querySelector("span").textContent = "Evaluating policy...";

  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload())
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.issues?.map((issue) => `${issue.path}: ${issue.message}`).join("; ") || body.error);
    renderReceipt(body);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "The evaluation could not be completed.");
  } finally {
    evaluateButton.disabled = false;
    evaluateButton.querySelector("span").textContent = "Evaluate transaction";
  }
}

async function copyReceipt() {
  if (!latestResponse) return;
  await navigator.clipboard.writeText(JSON.stringify(latestResponse, null, 2));
  byId("copy-receipt").textContent = "Copied";
  window.setTimeout(() => { byId("copy-receipt").textContent = "Copy JSON"; }, 1200);
}

function downloadReceipt() {
  if (!latestResponse) return;
  const blob = new Blob([JSON.stringify(latestResponse, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `txsentinel-${latestResponse.result.decision.toLowerCase()}-${latestResponse.result.receiptHash.slice(2, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function checkServices() {
  try {
    const api = await fetch("/api/health");
    if (!api.ok) throw new Error("offline");
    byId("api-status").innerHTML = "<i></i>API live";
  } catch {
    byId("api-status").classList.add("warn");
    byId("api-status").innerHTML = "<i></i>API unavailable";
  }

  try {
    const response = await fetch("/api/check-paid");
    const body = await response.json();
    const ready = body.status === "ready";
    byId("x402-status").className = `status-chip ${ready ? "" : "warn"}`;
    byId("x402-status").innerHTML = `<i></i>x402 ${ready ? "ready" : "staged"}`;
  } catch {
    byId("x402-status").className = "status-chip muted";
    byId("x402-status").innerHTML = "<i></i>x402 unavailable";
  }
}

document.querySelectorAll(".scenario-tab").forEach((tab) => {
  tab.addEventListener("click", () => loadScenario(tab.dataset.scenario));
});
byId("operation").addEventListener("change", updateOperationFields);
form.addEventListener("submit", evaluate);
byId("copy-receipt").addEventListener("click", copyReceipt);
byId("download-receipt").addEventListener("click", downloadReceipt);
loadScenario("safe");
checkServices();
