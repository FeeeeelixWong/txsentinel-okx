import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from "@okxweb3/x402-fetch";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/client";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  erc20Abi,
  formatUnits,
  getAddress,
  http
} from "viem";

const XLAYER_TESTNET = {
  network: "eip155:1952",
  rpcUrl: "https://testrpc.xlayer.tech/terigon",
  explorerUrl: "https://www.okx.com/web3/explorer/xlayer-test",
  faucetUrl: "https://web3.okx.com/xlayer/faucet/xlayerfaucet",
  chain: defineChain({
    id: 1952,
    name: "X Layer Testnet",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: ["https://testrpc.xlayer.tech/terigon"] } },
    blockExplorers: { default: { name: "OKX Explorer", url: "https://www.okx.com/web3/explorer/xlayer-test" } },
    testnet: true
  })
};

const PAYMENT_TOKENS = {
  TEST_USDT0: {
    ...XLAYER_TESTNET,
    asset: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
    symbol: "test USD₮0"
  },
  USDG: {
    ...XLAYER_TESTNET,
    asset: "0xa78e2baabaf5c4f36b7fc394725deb68d332eec1",
    symbol: "test USDG"
  },
  USDC: {
    ...XLAYER_TESTNET,
    asset: "0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d",
    symbol: "test USDC"
  }
};

const policyRequest = {
  chain: "xlayer",
  operation: "transfer",
  to: "0x4a6aae28b27681856ae824af82fea87896ecc3ed",
  amountUsd: 25,
  policy: {
    maxSpendUsd: 100,
    denyUnlimitedApprovals: true,
    requireSimulation: true
  },
  simulation: {
    status: "succeeded",
    estimatedFeeUsd: 0.01
  }
};

const elements = {
  quoteButton: document.getElementById("x402-load-quote"),
  connectButton: document.getElementById("x402-connect"),
  payButton: document.getElementById("x402-pay"),
  payToken: document.getElementById("x402-pay-token"),
  tokenInputs: [...document.querySelectorAll('input[name="x402-token"]')],
  message: document.getElementById("x402-message"),
  faucet: document.getElementById("x402-faucet"),
  title: document.getElementById("x402-proof-title"),
  badge: document.getElementById("x402-proof-badge"),
  network: document.getElementById("x402-network"),
  amount: document.getElementById("x402-amount"),
  payTo: document.getElementById("x402-pay-to"),
  buyer: document.getElementById("x402-buyer"),
  balance: document.getElementById("x402-balance"),
  transaction: document.getElementById("x402-transaction"),
  explorer: document.getElementById("x402-explorer"),
  steps: [
    document.getElementById("payment-step-quote"),
    document.getElementById("payment-step-wallet"),
    document.getElementById("payment-step-sign"),
    document.getElementById("payment-step-receipt")
  ]
};

let accepted;
let provider;
let buyerAddress;
let buyerBalance = 0n;

function selectedToken() {
  const key = elements.tokenInputs.find((input) => input.checked)?.value || "TEST_USDT0";
  return PAYMENT_TOKENS[key];
}

function displaySymbol(requirement = accepted) {
  return requirement?.extra?.symbol || requirement?.extra?.name || selectedToken().symbol;
}

function shorten(value, leading = 8, trailing = 6) {
  if (!value || value.length <= leading + trailing + 3) return value || "—";
  return `${value.slice(0, leading)}…${value.slice(-trailing)}`;
}

function decodeHeader(value) {
  const binary = window.atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function tokenDecimals(requirement) {
  const decimals = Number(requirement?.extra?.decimals ?? 6);
  return Number.isInteger(decimals) && decimals >= 0 ? decimals : 6;
}

function tokenAmount(requirement) {
  return formatUnits(BigInt(requirement.amount), tokenDecimals(requirement));
}

function setStep(index) {
  elements.steps.forEach((step, stepIndex) => {
    step?.classList.toggle("complete", stepIndex < index);
    step?.classList.toggle("active", stepIndex === index);
  });
}

function setMessage(message, type = "") {
  elements.message.textContent = message;
  elements.message.className = `payment-message${type ? ` ${type}` : ""}`;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (label) button.dataset.idleLabel ||= button.textContent;
  button.textContent = busy ? label : button.dataset.idleLabel || button.textContent;
}

function getWalletProvider() {
  const injected = window.okxwallet || window.ethereum;
  if (!injected?.request) {
    throw new Error("OKX Wallet was not detected. Install or unlock the browser extension first.");
  }
  return injected;
}

async function switchToXLayer(injectedProvider, token) {
  const chainHex = `0x${token.chain.id.toString(16)}`;
  try {
    await injectedProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
  } catch (error) {
    if (error?.code !== 4902 && error?.code !== -32603) throw error;
    await injectedProvider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chainHex,
        chainName: token.chain.name,
        nativeCurrency: token.chain.nativeCurrency,
        rpcUrls: [token.rpcUrl],
        blockExplorerUrls: [token.explorerUrl]
      }]
    });
  }
}

function requestOptions() {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policyRequest)
  };
}

async function loadQuote() {
  setBusy(elements.quoteButton, true, "Loading…");
  setMessage("Requesting the live payment terms from TxSentinel.");
  elements.faucet.classList.add("hidden");
  try {
    const response = await fetch("/api/check-paid", requestOptions());
    const encoded = response.headers.get("PAYMENT-REQUIRED");
    if (response.status !== 402 || !encoded) {
      throw new Error(`Expected a 402 payment challenge, received HTTP ${response.status}.`);
    }

    const paymentRequired = decodeHeader(encoded);
    const token = selectedToken();
    accepted = paymentRequired.accepts?.find((option) => (
      option.network === token.network
      && option.scheme === "exact"
      && option.asset?.toLowerCase() === token.asset
    ));
    if (!accepted) throw new Error("The server did not offer the expected X Layer exact-payment option.");

    elements.title.textContent = "Live terms loaded";
    elements.badge.textContent = "402 READY";
    elements.badge.className = "decision-badge hold";
    elements.network.textContent = `${token.chain.name} / ${accepted.network}`;
    elements.amount.textContent = `${tokenAmount(accepted)} ${displaySymbol(accepted)}`;
    elements.payTo.textContent = shorten(accepted.payTo);
    elements.payTo.title = accepted.payTo;
    elements.connectButton.disabled = false;
    elements.payButton.querySelector("span").textContent = `Confirm ${tokenAmount(accepted)} payment`;
    elements.payToken.textContent = displaySymbol(accepted);
    setStep(1);
    setMessage("Terms loaded. Connect a buyer wallet to verify its network and test-token balance.");
  } catch (error) {
    setMessage(error.message || "Unable to load the payment terms.", "error");
  } finally {
    setBusy(elements.quoteButton, false);
  }
}

async function connectWallet() {
  setBusy(elements.connectButton, true, "Connecting…");
  setMessage("Waiting for the wallet connection and network confirmation.");
  try {
    provider = getWalletProvider();
    const token = selectedToken();
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!accounts?.[0]) throw new Error("No wallet account was returned.");
    await switchToXLayer(provider, token);
    buyerAddress = getAddress(accounts[0]);

    const publicClient = createPublicClient({ chain: token.chain, transport: http(token.rpcUrl) });
    buyerBalance = await publicClient.readContract({
      address: getAddress(accepted.asset),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [buyerAddress]
    });

    const decimals = tokenDecimals(accepted);
    const hasFunds = buyerBalance >= BigInt(accepted.amount);
    elements.buyer.textContent = shorten(buyerAddress);
    elements.buyer.title = buyerAddress;
    elements.balance.textContent = `${formatUnits(buyerBalance, decimals)} ${displaySymbol()}`;
    elements.connectButton.textContent = "Wallet connected";
    elements.connectButton.dataset.idleLabel = "Wallet connected";
    elements.payButton.disabled = !hasFunds;
    elements.faucet.classList.toggle("hidden", hasFunds || !token.faucetUrl);
    if (token.faucetUrl) elements.faucet.href = token.faucetUrl;
    setStep(2);
    setMessage(
      hasFunds
        ? "Wallet is ready. The next button is the payment confirmation gate; OKX Wallet will ask for the EIP-3009 signature."
        : `Insufficient balance on ${token.chain.name}. This payment requires ${tokenAmount(accepted)} ${displaySymbol()}.`,
      hasFunds ? "" : "error"
    );
  } catch (error) {
    setMessage(error.shortMessage || error.message || "Wallet connection failed.", "error");
  } finally {
    elements.connectButton.disabled = false;
    if (buyerAddress) elements.connectButton.textContent = "Wallet connected";
  }
}

async function payAndRun() {
  if (!accepted || !provider || !buyerAddress) return;
  elements.payButton.disabled = true;
  const payLabel = elements.payButton.querySelector("span");
  const idleLabel = payLabel.textContent;
  payLabel.textContent = "Signing in wallet…";
  setMessage("Review and approve the exact payment authorization in OKX Wallet.");
  try {
    const token = selectedToken();
    await switchToXLayer(provider, token);
    const walletClient = createWalletClient({
      account: buyerAddress,
      chain: token.chain,
      transport: custom(provider)
    });
    const signer = {
      address: buyerAddress,
      signTypedData: (typedData) => walletClient.signTypedData({ ...typedData, account: buyerAddress })
    };
    const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: token.network, client: new ExactEvmScheme(signer) }],
      policies: [(_version, requirements) => requirements.filter((requirement) => (
        requirement.network === token.network
        && requirement.asset?.toLowerCase() === token.asset
      ))]
    });
    const response = await fetchWithPayment("/api/check-paid", requestOptions());
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(responseBody?.error || responseBody?.message || `Paid request failed with HTTP ${response.status}.`);
    }

    const encodedReceipt = response.headers.get("PAYMENT-RESPONSE");
    if (!encodedReceipt) throw new Error("The policy check succeeded, but no settlement receipt was returned.");
    const receipt = decodePaymentResponseHeader(encodedReceipt);
    const transaction = receipt.transaction || receipt.txHash || receipt.transactionHash;

    elements.title.textContent = "Settlement verified";
    elements.badge.textContent = "SETTLED";
    elements.badge.className = "decision-badge allow";
    elements.transaction.textContent = shorten(transaction || "Receipt returned");
    elements.transaction.title = transaction || JSON.stringify(receipt);
    if (transaction) {
      elements.explorer.href = `${token.explorerUrl}/tx/${transaction}`;
      elements.explorer.classList.remove("hidden");
    }
    setStep(4);
    setMessage(`Payment settled and policy decision returned: ${responseBody.decision || "verified"}.`, "success");
    payLabel.textContent = "Payment settled";
  } catch (error) {
    setStep(2);
    setMessage(error.shortMessage || error.message || "Payment was not completed.", "error");
    payLabel.textContent = idleLabel;
    elements.payButton.disabled = buyerBalance < BigInt(accepted.amount);
  }
}

function resetForTokenChange() {
  const token = selectedToken();
  accepted = undefined;
  buyerAddress = undefined;
  buyerBalance = 0n;
  elements.connectButton.disabled = true;
  elements.connectButton.textContent = "Connect OKX Wallet";
  elements.connectButton.dataset.idleLabel = "Connect OKX Wallet";
  elements.payButton.disabled = true;
  elements.payButton.querySelector("span").textContent = "Confirm payment";
  elements.payToken.textContent = token.symbol;
  elements.faucet.classList.add("hidden");
  elements.title.textContent = "Awaiting challenge";
  elements.badge.textContent = "PENDING";
  elements.badge.className = "decision-badge hold";
  [elements.network, elements.amount, elements.payTo, elements.buyer, elements.balance, elements.transaction]
    .forEach((element) => { element.textContent = "—"; });
  elements.explorer.classList.add("hidden");
  setStep(0);
  setMessage(`Load live terms for ${token.symbol} on ${token.chain.name}.`);
}

elements.quoteButton?.addEventListener("click", loadQuote);
elements.connectButton?.addEventListener("click", connectWallet);
elements.payButton?.addEventListener("click", payAndRun);
elements.tokenInputs.forEach((input) => input.addEventListener("change", resetForTokenChange));
