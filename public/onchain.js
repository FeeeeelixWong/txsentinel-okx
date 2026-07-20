const byId = (id) => document.getElementById(id);

let artifact;
let deployment;
let provider;
let account;
let contractAddress = "";
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

function hexQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function formatNative(value, decimals = 8) {
  const base = 10n ** 18n;
  const whole = value / base;
  const fraction = (value % base).toString().padStart(18, "0").slice(0, decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

async function directRpc(method, params = []) {
  let lastError;
  for (const url of artifact.network.rpcUrls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
      });
      if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(body.error.message || `RPC ${method} failed`);
      return body.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`RPC ${method} failed`);
}

async function prepareTransaction(transaction) {
  const [chainId, estimateHex, gasPriceHex, balanceHex] = await Promise.all([
    directRpc("eth_chainId"),
    directRpc("eth_estimateGas", [transaction]),
    directRpc("eth_gasPrice"),
    directRpc("eth_getBalance", [account, "latest"])
  ]);
  if (chainId.toLowerCase() !== artifact.network.chainIdHex) {
    throw new Error(`RPC chain mismatch: expected ${artifact.network.chainIdHex}, received ${chainId}.`);
  }

  const estimate = BigInt(estimateHex);
  const gasPrice = BigInt(gasPriceHex);
  const gasLimit = (estimate * 120n + 99n) / 100n;
  const maximumFee = gasLimit * gasPrice;
  if (BigInt(balanceHex) < maximumFee) {
    throw new Error(`Insufficient X Layer Testnet OKB. Maximum estimated fee is ${formatNative(maximumFee)} OKB.`);
  }

  return {
    transaction: {
      ...transaction,
      gas: hexQuantity(gasLimit),
      gasPrice: hexQuantity(gasPrice)
    },
    estimate,
    gasLimit,
    maximumFee
  };
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
  const link = byId("canonical-contract-link");
  link.classList.toggle("disabled", !contractAddress);
  if (contractAddress) link.href = explorerUrl("address", contractAddress);
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
    setActivity("Wallet connected", "X Layer Testnet is selected. Policy actions require explicit wallet confirmation.");
    await inspectContract();
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

async function waitForCondition(check, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  return false;
}

async function sendTransaction(data, label) {
  await ensureNetwork();
  const baseTransaction = {
    from: account,
    ...(contractAddress ? { to: contractAddress } : {}),
    data,
    value: "0x0"
  };
  setActivity(`${label} preflight`, "Estimating gas against the official X Layer Testnet RPC.");
  const { transaction, gasLimit, maximumFee } = await prepareTransaction(baseTransaction);
  setActivity(
    `${label} awaiting confirmation`,
    `Review X Layer Testnet, zero value, gas limit ${gasLimit}, and a maximum estimated fee of ${formatNative(maximumFee)} OKB.`
  );
  const startingNonce = BigInt(await directRpc("eth_getTransactionCount", [account, "latest"]));
  const walletRequest = provider.request({ method: "eth_sendTransaction", params: [transaction] })
    .then((hash) => ({ hash }));
  const walletResult = await Promise.race([
    walletRequest,
    new Promise((resolve) => window.setTimeout(() => resolve(null), 15000))
  ]);

  if (!walletResult) {
    setActivity(
      `${label} callback delayed`,
      "OKX Wallet has not returned a transaction hash. Checking X Layer directly; do not retry this action."
    );
    const broadcastDetected = await waitForCondition(async () => {
      const currentNonce = BigInt(await directRpc("eth_getTransactionCount", [account, "latest"]));
      return currentNonce > startingNonce;
    });
    if (!broadcastDetected) {
      throw new Error("No confirmed transaction was detected after the wallet callback timed out. Check wallet activity before retrying.");
    }
    return { hash: "", receipt: null, recovered: true };
  }

  const hash = walletResult.hash;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash || "")) {
    throw new Error("OKX Wallet returned an invalid transaction hash. Check wallet activity before retrying.");
  }
  setActivity(`${label} submitted`, "Waiting for X Layer confirmation.", explorerUrl("tx", hash));
  const receipt = await waitForReceipt(hash);
  return { hash, receipt, recovered: false };
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

async function readPolicy() {
  const data = encodeCall("policies(address,bytes32)", [account, artifact.defaults.policyKey]);
  const result = await directRpc("eth_call", [{ to: contractAddress, data }, "latest"]);
  return decodePolicy(result);
}

async function receiptIsAnchored(receiptHash) {
  const data = encodeCall("receipts(address,bytes32,bytes32)", [
    account,
    artifact.defaults.policyKey,
    receiptHash
  ]);
  const result = await directRpc("eth_call", [{ to: contractAddress, data }, "latest"]);
  const words = result.slice(2).match(/.{64}/g) || [];
  return words.length >= 4 && BigInt(`0x${words[3]}`) !== 0n;
}

async function inspectContract() {
  if (!provider || !contractAddress) return;
  try {
    const code = await provider.request({ method: "eth_getCode", params: [contractAddress, "latest"] });
    if (!code || code === "0x") throw new Error("No contract bytecode exists at the canonical X Layer address.");
    if (code.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) {
      throw new Error("Canonical contract runtime bytecode does not match the reviewed artifact.");
    }
    const policy = await readPolicy();
    byId("policy-value").textContent = policy.registered
      ? `${policy.active ? "Active" : "Inactive"} / revision ${policy.revision}`
      : "Not registered";
    setActivity("Canonical contract verified", `Reviewed runtime bytecode confirmed at ${contractAddress}.`, explorerUrl("address", contractAddress));
  } catch (error) {
    byId("policy-value").textContent = "Unavailable";
    setActivity("Contract check failed", error?.message || "The address could not be verified.", "", true);
  }
}

async function registerPolicy() {
  setBusy(true);
  try {
    const data = encodeCall("registerPolicy(bytes32,bytes32,bytes32)", [
      artifact.defaults.policyKey,
      artifact.defaults.policyHash,
      artifact.defaults.versionHash
    ]);
    const { hash, recovered } = await sendTransaction(data, "Policy registration");
    if (recovered && !(await waitForCondition(async () => (await readPolicy()).registered))) {
      throw new Error("A transaction was confirmed, but the policy registration was not found. Do not retry before checking wallet activity.");
    }
    byId("policy-value").textContent = "Active / revision 1";
    setActivity(
      recovered ? "Policy registration recovered" : "Policy registered",
      recovered
        ? "The wallet callback was lost, but policy v1 was confirmed directly from the canonical contract."
        : "TxSentinel policy v1 is active and owned by the connected wallet.",
      recovered ? explorerUrl("address", contractAddress) : explorerUrl("tx", hash)
    );
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
    const { hash, recovered } = await sendTransaction(data, "Receipt anchor");
    if (recovered && !(await waitForCondition(() => receiptIsAnchored(latestReceipt.receiptHash)))) {
      throw new Error("A transaction was confirmed, but the receipt anchor was not found. Do not retry before checking wallet activity.");
    }
    byId("receipt-value").textContent = `${latestReceipt.decision} / anchored`;
    setActivity(
      recovered ? "Receipt anchor recovered" : "Receipt anchored on X Layer",
      recovered
        ? `${latestReceipt.receiptHash} was confirmed directly from the canonical contract after a lost wallet callback.`
        : `${latestReceipt.receiptHash} is now independently verifiable.`,
      recovered ? explorerUrl("address", contractAddress) : explorerUrl("tx", hash)
    );
  } catch (error) {
    setActivity("Receipt anchor not completed", error?.message || "The transaction failed.", "", true);
  } finally {
    setBusy(false);
  }
}

async function initialize() {
  [artifact, deployment] = await Promise.all([
    fetch("/contracts/TxSentinelPolicyAnchor.json").then((response) => response.json()),
    fetch("/contracts/deployment.json").then((response) => response.json())
  ]);
  if (deployment.status !== "deployed" || !/^0x[0-9a-fA-F]{40}$/.test(deployment.contractAddress)) {
    throw new Error("Canonical X Layer deployment metadata is unavailable.");
  }
  contractAddress = deployment.contractAddress;
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
byId("register-policy").addEventListener("click", registerPolicy);
byId("evaluate-live").addEventListener("click", evaluateLive);
byId("anchor-receipt").addEventListener("click", anchorReceipt);
initialize().catch((error) => setActivity("Initialization failed", error.message, "", true));
