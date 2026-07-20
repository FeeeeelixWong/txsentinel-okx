const setServiceState = (id, label, state = "") => {
  const element = document.getElementById(id);
  if (!element) return;
  element.className = `status-chip ${state}`.trim();
  element.innerHTML = `<i></i>${label}`;
};

const setText = (id, value, state = "") => {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = value;
  element.className = state;
};

async function checkSharedServices() {
  if (!document.getElementById("api-status") && !document.getElementById("api-state")) return;

  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("offline");
    setServiceState("api-status", "API live");
    setText("api-state", "Live", "state-live");
  } catch {
    setServiceState("api-status", "API unavailable", "warn");
    setText("api-state", "Unavailable", "state-warn");
  }

  try {
    const response = await fetch("/api/check-paid");
    const body = await response.json();
    const ready = body.status === "ready";
    setServiceState("x402-status", `x402 ${ready ? "ready" : "staged"}`, ready ? "" : "warn");
    setText("x402-state", ready ? "Ready" : "Staged", ready ? "state-live" : "state-warn");
  } catch {
    setServiceState("x402-status", "x402 unavailable", "muted");
    setText("x402-state", "Unavailable", "state-warn");
  }
}

checkSharedServices();
