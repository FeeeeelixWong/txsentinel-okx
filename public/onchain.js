const byId = (id) => document.getElementById(id);
const storageKey = "txsentinel:xlayer-testnet:anchor-address";

let artifact;
let provider;
let account;
let contractAddress = localStorage.getItem(storageKey) || "";
let latestReceipt;
let busy = false;

function shortHex(value, start = 10, end = 8) {
  return value ? `${value.slice(0, start)}...${value.slice(-end)}` : "-";
}

function walletProvider() {
  if (window.okxwallet) return window.okxwallet;
  const providers = window.ethereum?.providers || [];
  return providers.find((candidate) => candidate.isOkxWallet) || window.ethereum;
}

function selector(signature) {
  const value = artifact.methodIdentifiers[signature];
  if (!value) throw new Error(`Missing selector for ${signature}`);
  return value;
}

function word(value) {
  const normalized = String(value).replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length > 64) throw new Error("Invalid ABI value");
  return normalized.padStart(64, "0");
}

function encodeCall(signature, values) {
  return `0x${selector(signature)}${values.map(word).join("")}`;
}

function explorerUrl(type, value) {
  return `${artifact.network.blockExplorerUrl}/${type}/${value}`;
}

function setActivity(title, detail, link = "", isError = false) {
  byId("activity-title").textContent = title;
  byId("activity-detail").textContent = detail;
  byId("transaction-panel").classList.toggle("error", isError);
  const anchor = byId("activity-link");
  anchor.classList.toggle("hidden", !link);
  if (link) anchor.href = link;
}

function setBusy(value) {
  busy = value;
  refreshControls();
}

function refreshControls() {
  byId("deploy-contract").disabled = busy || !account;
  byId("register-policy").disabled = busy || !account || !contractAddress;
  byId("anchor-receipt").disabled = busy || !account || !contractAddress || !latestReceipt;
  byId("connect-wallet").disabled = busy;
  byId("evaluate-live").disabled = busy;
}

function updateWalletState() {
  const connected = Boolean(account);
  byId("wallet-value").textContent = connected ? shortHex(account) : "Not connected";
  byId("wallet-chip").className = `status-chip ${connected ? "" : "muted"}`;
  byId("wallet-chip").innerHTML = `<i></i>${connected ? shortHex(account, 8, 5) : "Wallet disconnected"}`;
  byId("connect-wallet").textContent = connected ? "Wallet connected" : "Connect wallet";
  refreshControls();
}

function updateContractState() {
  byId("contract-value").textContent = contractAddress ? shortHex(contractAddress) : "Not deployed";
  byId("existing-address").value = contractAddress;
  refreshControls();
}

async function ensureNetwork() {
  const current = await provider.request({ method: "eth_chainId" });
  if (current.toLowerCase() === artifact.network.chainIdHex) {
    byId("network-chip").className = "status-chip";
    byId("network-chip").innerHTML = "<i></i>X Layer Testnet";
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: artifact.network.chainIdHex }]
    });
  } catch (error) {
    if (error?.code !== 4902 && error?.code !== -32603) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: artifact.network.chainIdHex,
        chainName: artifact.network.name,
        nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
        rpcUrls: artifact.network.rpcUrls,
        blockExplorerUrls: [artifact.network.blockExplorerUrl]
      }]
    });
  }

  byId("network-chip").className = "status-chip";
  byId("network-chip").innerHTML = "<i></i>X Layer Testnet";
}

async function connectWallet() {
  provider = walletProvider();
  if (!provider) {
    setActivity("OKX Wallet not found", "Install or enable the OKX Wallet browser extension, then reload this page.", "", true);
    return;
  }

  setBusy(true);
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    account = accounts[0];
    await ensureNetwork();
    updateWalletState();
    await inspectContract();
    setActivity("Wallet connected", "X Layer Testnet is selected. Deployment actions now require explicit wallet confirmation.");
  } catch (error) {
    setActivity("Wallet connection stopped", error?.message || "The wallet request was not completed.", "", true);
  } finally {
    setBusy(false);
  }
}

async function waitForReceipt(hash, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error("The transaction reverted onchain.");
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error("Transaction confirmation timed out. Check the explorer before retrying.");
}

async function sendTransaction(data, label) {
  await ensureNetwork();
  setActivity(`${label} awaiting confirmation`, "Review the network, contract action, and fee in OKX Wallet.");
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: account, ...(contractAddress ? { to: contractAddress } : {}), data }]
  });
  setActivity(`${label} submitted`, "Waiting for X Layer confirmation.", explorerUrl("tx", hash));
  const receipt = await waitForReceipt(hash);
  return { hash, receipt };
}

async function deployContract() {
  setBusy(true);
  try {
    const previousAddress = contractAddress;
    contractAddress = "";
    const { hash, receipt } = await sendTransaction(artifact.bytecode, "Contract deployment");
    contractAddress = receipt.contractAddress;
    localStorage.setItem(storageKey, contractAddress);
    updateContractState();
    byId("policy-value").textContent = "Not registered";
    setActivity("Contract deployed", `Immutable anchor deployed at ${contractAddress}.`, explorerUrl("tx", hash));
  } catch (error) {
    contractAddress = localStorage.getItem(storageKey) || "";
    updateContractState();
    setActivity("Deployment not completed", error?.message || "The deployment failed.", "", true);
  } finally {
    setBusy(false);
  }
}

async function hasContractCode(address) {
  const code = await provider.request({ method: "eth_getCode", params: [address, "latest"] });
  return code && code !== "0x";
}

function decodePolicy(policyResult) {
  if (!policyResult || policyResult === "0x" || policyResult.length < 258) {
    return { registered: false, active: false, revision: 0n };
  }
  const words = policyResult.slice(2).match(/.{64}/g) || [];
  return {
    registered: words[0] !== "0".repeat(64),
    revision: BigInt(`0x${words[2]}`),
    active: BigInt(`0x${words[3]}`) === 1n
  };
}

async function inspectContract() {
  if (!provider || !contractAddress) return;
  try {
    if (!(await hasContractCode(contractAddress))) throw new Error("No contract bytecode exists at this address on X Layer Testnet.");
    const data = encodeCall("policies(address,bytes32)", [account, artifact.defaults.policyKey]);
    const result = await provider.request({ method: "eth_call", params: [{ to: contractAddress, data }, "latest"] });
    const policy = decodePolicy(result);
    byId("policy-value").textContent = policy.registered
      ? `${policy.active ? "Active" : "Inactive"} / revision ${policy.revision}`
      : "Not registered";
    setActivity("Contract verified", `Bytecode found at ${contractAddress}.`, explorerUrl("address", contractAddress));
  } catch (error) {
    byId("policy-value").textContent = "Unavailable";
    setActivity("Contract check failed", error?.message || "The address could not be verified.", "", true);
  }
}

async function useExistingContract() {
  const candidate = byId("existing-address").value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(candidate)) {
    setActivity("Invalid contract address", "Enter a 20-byte EVM contract address beginning with 0x.", "", true);
    return;
  }
  contractAddress = candidate;
  localStorage.setItem(storageKey, contractAddress);
  updateContractState();
  if (account) await inspectContract();
}

async function registerPolicy() {
  setBusy(true);
  try {
    const data = encodeCall("registerPolicy(bytes32,bytes32,bytes32)", [
      artifact.defaults.policyKey,
      artifact.defaults.policyHash,
      artifact.defaults.versionHash
    ]);
    const { hash } = await sendTransaction(data, "Policy registration");
    byId("policy-value").textContent = "Active / revision 1";
    setActivity("Policy registered", "TxSentinel policy v1 is active and owned by the connected wallet.", explorerUrl("tx", hash));
  } catch (error) {
    setActivity("Policy registration not completed", error?.message || "The transaction failed.", "", true);
  } finally {
    setBusy(false);
  }
}

async function evaluateLive() {
  setBusy(true);
  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chain: "xlayer",
        operation: "transfer",
        to: "0x4a6aae28b27681856ae824af82fea87896ecc3ed",
        amountUsd: 25,
        policy: artifact.defaults.policy,
        simulation: {
          status: "succeeded",
          estimatedFeeUsd: 0.01,
          slippageBps: 0,
          contractVerified: false
        }
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Policy API request failed.");
    latestReceipt = body.result;
    byId("anchor-preview").innerHTML = `
      <div><span>DECISION</span><strong class="${latestReceipt.decision.toLowerCase()}">${latestReceipt.decision}</strong></div>
      <div><span>ACTION</span><code title="${latestReceipt.actionDigest}">${shortHex(latestReceipt.actionDigest)}</code></div>
      <div><span>RECEIPT</span><code title="${latestReceipt.receiptHash}">${shortHex(latestReceipt.receiptHash)}</code></div>
    `;
    byId("receipt-value").textContent = `${latestReceipt.decision} / prepared`;
    setActivity("Live receipt prepared", "The public policy API returned deterministic hashes ready for onchain anchoring.");
  } catch (error) {
    setActivity("Evaluation failed", error?.message || "The API request could not be completed.", "", true);
  } finally {
    setBusy(false);
  }
}

async function anchorReceipt() {
  setBusy(true);
  try {
    const decisions = { ALLOW: 0, HOLD: 1, DENY: 2 };
    const data = encodeCall("anchorReceipt(bytes32,address,bytes32,bytes32,uint8)", [
      latestReceipt.receiptHash,
      account,
      artifact.defaults.policyKey,
      latestReceipt.actionDigest,
      decisions[latestReceipt.decision]
    ]);
    const { hash } = await sendTransaction(data, "Receipt anchor");
    byId("receipt-value").textContent = `${latestReceipt.decision} / anchored`;
    setActivity("Receipt anchored on X Layer", `${latestReceipt.receiptHash} is now independently verifiable.`, explorerUrl("tx", hash));
  } catch (error) {
    setActivity("Receipt anchor not completed", error?.message || "The transaction failed.", "", true);
  } finally {
    setBusy(false);
  }
}

async function initialize() {
  artifact = await fetch("/contracts/TxSentinelPolicyAnchor.json").then((response) => response.json());
  byId("policy-id").textContent = shortHex(artifact.defaults.policyKey, 14, 12);
  byId("policy-id").title = artifact.defaults.policyKey;
  byId("policy-hash").textContent = shortHex(artifact.defaults.policyHash, 14, 12);
  byId("policy-hash").title = artifact.defaults.policyHash;
  updateContractState();
  updateWalletState();

  provider = walletProvider();
  if (provider) {
    const accounts = await provider.request({ method: "eth_accounts" });
    account = accounts[0];
    updateWalletState();
    if (account) {
      await ensureNetwork().catch(() => {});
      await inspectContract();
    }
    provider.on?.("accountsChanged", ([nextAccount]) => {
      account = nextAccount;
      updateWalletState();
    });
    provider.on?.("chainChanged", () => window.location.reload());
  }
}

byId("connect-wallet").addEventListener("click", connectWallet);
byId("deploy-contract").addEventListener("click", deployContract);
byId("use-existing").addEventListener("click", useExistingContract);
byId("register-policy").addEventListener("click", registerPolicy);
byId("evaluate-live").addEventListener("click", evaluateLive);
byId("anchor-receipt").addEventListener("click", anchorReceipt);
initialize().catch((error) => setActivity("Initialization failed", error.message, "", true));
