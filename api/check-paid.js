const express = require("express");
const { OKXFacilitatorClient } = require("@okxweb3/x402-core");
const { ExactEvmScheme } = require("@okxweb3/x402-evm/exact/server");
const { paymentMiddleware, x402ResourceServer } = require("@okxweb3/x402-express");
const { evaluateTransaction, validateTransaction } = require("../lib/policy");

const DEFAULT_FACILITATOR_BASE_URL = "https://web3.okx.com";
const FACILITATOR_DISCOVERY_ATTEMPTS = 3;
const PAYMENT_ASSETS = Object.freeze({
  TEST_USDT0: {
    network: "eip155:1952",
    asset: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
    name: "USD₮0",
    symbol: "test USD₮0",
    version: "1",
    decimals: 6
  },
  USDG: {
    network: "eip155:1952",
    asset: "0xa78e2baabaf5c4f36b7fc394725deb68d332eec1",
    name: "Global Dollar",
    symbol: "test USDG",
    version: "1",
    decimals: 6
  },
  USDC: {
    network: "eip155:1952",
    asset: "0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d",
    name: "USDC_TEST",
    symbol: "test USDC",
    version: "2",
    decimals: 6
  }
});

function resolveFacilitatorBaseUrl(env = process.env) {
  return env.OKX_X402_BASE_URL || DEFAULT_FACILITATOR_BASE_URL;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function retrySupportedDiscovery(load, options = {}) {
  const attempts = options.attempts || FACILITATOR_DISCOVERY_ATTEMPTS;
  const pause = options.wait || wait;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await pause(attempt * 120);
    }
  }

  throw lastError;
}

class ResilientOKXFacilitatorClient extends OKXFacilitatorClient {
  getSupported() {
    return retrySupportedDiscovery(() => super.getSupported());
  }
}

function priceToAtomicUnits(value, decimals = 6) {
  const normalized = String(value).trim().replace(/^\$/, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error(`Invalid X402_PRICE: ${value}`);
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new Error(`X402_PRICE supports at most ${decimals} decimal places`);
  return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals))).toString();
}

function buildPaymentOptions(payTo, price) {
  const amount = priceToAtomicUnits(price);
  return Object.values(PAYMENT_ASSETS).map((token) => ({
    scheme: "exact",
    network: token.network,
    payTo,
    price: {
      amount,
      asset: token.asset,
      extra: {
        name: token.name,
        version: token.version,
        symbol: token.symbol,
        decimals: token.decimals
      }
    }
  }));
}

const app = express();
const price = process.env.X402_PRICE || "$0.01";
const payTo = process.env.PAY_TO_ADDRESS || "";
const requiredCredentials = ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE"];
const missingCredentials = requiredCredentials.filter((key) => !process.env[key]);
const configured = Boolean(payTo) && missingCredentials.length === 0;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));

function preparePolicyEvaluation(req, res, next) {
  if (req.method !== "POST") return next();

  const validation = validateTransaction(req.body || {});
  if (!validation.success) {
    return res.status(422).json({
      ok: false,
      error: "INVALID_POLICY_REQUEST",
      message: "The request was rejected before any x402 payment challenge or settlement.",
      issues: validation.issues
    });
  }

  req.txSentinelEvaluation = evaluateTransaction(validation.data);
  return next();
}

app.get("/api/check-paid", (req, res) => {
  res.status(200).json({
    service: "TxSentinel x402 Policy Check",
    status: configured ? "ready" : "configuration_required",
    protocol: "OKX x402",
    sdk: "@okxweb3/x402-express",
    networks: [...new Set(Object.values(PAYMENT_ASSETS).map((asset) => asset.network))],
    assets: Object.values(PAYMENT_ASSETS).map(({ network, asset, symbol }) => ({ network, asset, symbol })),
    price,
    missing: configured ? [] : [...missingCredentials, ...(payTo ? [] : ["PAY_TO_ADDRESS"])]
  });
});

app.use("/api/check-paid", preparePolicyEvaluation);

if (configured) {
  const facilitator = new ResilientOKXFacilitatorClient({
    apiKey: process.env.OKX_API_KEY,
    secretKey: process.env.OKX_SECRET_KEY,
    passphrase: process.env.OKX_PASSPHRASE,
    baseUrl: resolveFacilitatorBaseUrl(),
    syncSettle: true
  });
  const resourceServer = new x402ResourceServer(facilitator)
    .register("eip155:1952", new ExactEvmScheme());

  app.use(
    paymentMiddleware(
      {
        "POST /api/check-paid": {
          accepts: buildPaymentOptions(payTo, price),
          description: "Deterministic transaction policy evaluation with a signed x402 settlement receipt"
        }
      },
      resourceServer,
      undefined,
      undefined,
      true
    )
  );
}

app.post("/api/check-paid", (req, res) => {
  if (!configured) {
    return res.status(503).json({
      ok: false,
      error: "X402_CONFIGURATION_REQUIRED",
      message: "The free, non-binding preflight remains available at /api/preflight.",
      missing: [...missingCredentials, ...(payTo ? [] : ["PAY_TO_ADDRESS"])]
    });
  }

  return res.status(200).json({
    ok: true,
    protocol: "OKX x402",
    access: "paid-formal-decision",
    prepaymentValidation: true,
    evaluatedAt: new Date().toISOString(),
    result: req.txSentinelEvaluation
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("x402 request failed", error?.message || error);
  return res.status(502).json({
    ok: false,
    error: "X402_FACILITATOR_UNAVAILABLE",
    message: "The payment facilitator is temporarily unavailable. No payment was authorized; please retry."
  });
});

module.exports = app;
module.exports.PAYMENT_ASSETS = PAYMENT_ASSETS;
module.exports.buildPaymentOptions = buildPaymentOptions;
module.exports.priceToAtomicUnits = priceToAtomicUnits;
module.exports.resolveFacilitatorBaseUrl = resolveFacilitatorBaseUrl;
module.exports.retrySupportedDiscovery = retrySupportedDiscovery;
module.exports.preparePolicyEvaluation = preparePolicyEvaluation;
