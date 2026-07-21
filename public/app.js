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
const previousButton = byId("previous-step");
const nextButton = byId("next-step");
let latestResponse = null;
let currentStep = 1;
let maxStepReached = 1;

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
    tab.setAttribute("aria-pressed", String(active));
  });

  resetReceipt();
  showStep(1);
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

function resetReceipt() {
  latestResponse = null;
  byId("empty-receipt").classList.remove("hidden");
  byId("receipt-content").classList.add("hidden");
  byId("error-panel").classList.add("hidden");
  const badge = byId("decision-badge");
  badge.textContent = "READY";
  badge.className = "decision-badge idle";
  evaluateButton.querySelector("span").textContent = "Run free preflight";
}

function updateReview() {
  const operation = byId("operation").selectedOptions[0]?.textContent || byId("operation").value;
  const chain = byId("chain").selectedOptions[0]?.textContent || byId("chain").value;
  byId("review-action").textContent = `${operation} on ${chain} · $${numberValue("amount").toLocaleString()}`;
  byId("review-to").textContent = byId("to").value.trim() || "Not set";
  byId("review-to").title = byId("to").value.trim();
  byId("review-cap").textContent = `$${numberValue("max-spend").toLocaleString()} spend · $${numberValue("max-fee").toLocaleString()} fee`;
  byId("review-evidence").textContent = `${byId("simulation-status").selectedOptions[0]?.textContent || "Not set"} · ${byId("contract-verified").checked ? "verified contract" : "unverified contract"}`;
}

function showStep(step) {
  currentStep = Math.min(4, Math.max(1, step));
  maxStepReached = Math.max(maxStepReached, currentStep);

  document.querySelectorAll(".wizard-panel").forEach((panel) => {
    panel.classList.toggle("active", Number(panel.dataset.panel) === currentStep);
  });
  document.querySelectorAll(".wizard-step").forEach((button) => {
    const buttonStep = Number(button.dataset.step);
    button.disabled = buttonStep > maxStepReached;
    button.classList.toggle("active", buttonStep === currentStep);
    button.classList.toggle("complete", buttonStep < currentStep || buttonStep < maxStepReached);
    if (buttonStep === currentStep) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });

  previousButton.disabled = currentStep === 1;
  nextButton.classList.toggle("hidden", currentStep === 4);
  evaluateButton.classList.toggle("hidden", currentStep !== 4);
  byId("step-position").textContent = `Step ${currentStep} of 4`;
  if (currentStep === 4) updateReview();
}

function canAdvance() {
  if (currentStep !== 1) return true;
  const recipient = byId("to");
  if (!recipient.value.trim()) recipient.setCustomValidity("Enter a recipient or contract address.");
  else recipient.setCustomValidity("");
  if (!recipient.reportValidity()) return false;
  return byId("amount").reportValidity();
}

function renderPreflight(response) {
  latestResponse = response;
  const preflight = response.preflight;
  const statusClass = { READY: "allow", REVIEW: "hold", BLOCKED: "deny" }[preflight.status] || "idle";
  const badge = byId("decision-badge");
  badge.textContent = preflight.status;
  badge.className = `decision-badge ${statusClass}`;
  byId("empty-receipt").classList.add("hidden");
  byId("error-panel").classList.add("hidden");
  byId("receipt-content").classList.remove("hidden");
  byId("preflight-access").textContent = "Free preflight";
  byId("preflight-binding").textContent = preflight.binding ? "Yes" : "No";
  byId("preflight-receipt").textContent = preflight.receiptIssued ? "Issued" : "Not issued";
  byId("evaluated-at").textContent = new Date(response.checkedAt).toLocaleTimeString();
  byId("preflight-next-title").textContent = preflight.next.action.replaceAll("_", " ");
  byId("preflight-next").textContent = `${preflight.next.label}. The formal paid endpoint returns detailed evidence and deterministic hashes.`;
  byId("raw-response").textContent = JSON.stringify(response, null, 2);
  evaluateButton.querySelector("span").textContent = "Run preflight again";
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
  evaluateButton.setAttribute("aria-busy", "true");
  evaluateButton.querySelector("span").textContent = "Running preflight...";

  try {
    const response = await fetch("/api/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload())
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.issues?.map((issue) => `${issue.path}: ${issue.message}`).join("; ") || body.error);
    renderPreflight(body);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "The evaluation could not be completed.");
  } finally {
    evaluateButton.disabled = false;
    evaluateButton.removeAttribute("aria-busy");
    evaluateButton.querySelector("span").textContent = latestResponse ? "Run preflight again" : "Run free preflight";
  }
}

async function copyPreflight() {
  if (!latestResponse) return;
  await navigator.clipboard.writeText(JSON.stringify(latestResponse, null, 2));
  byId("copy-preflight").textContent = "Copied";
  window.setTimeout(() => { byId("copy-preflight").textContent = "Copy preflight JSON"; }, 1200);
}

document.querySelectorAll(".scenario-tab").forEach((tab) => {
  tab.addEventListener("click", () => loadScenario(tab.dataset.scenario));
});
byId("operation").addEventListener("change", updateOperationFields);
form.addEventListener("submit", evaluate);
form.addEventListener("input", () => {
  if (currentStep === 4) updateReview();
  if (latestResponse) resetReceipt();
});
nextButton.addEventListener("click", () => {
  if (canAdvance()) showStep(currentStep + 1);
});
previousButton.addEventListener("click", () => showStep(currentStep - 1));
document.querySelectorAll(".wizard-step").forEach((button) => {
  button.addEventListener("click", () => showStep(Number(button.dataset.step)));
});
byId("copy-preflight").addEventListener("click", copyPreflight);
loadScenario("safe");
showStep(1);
