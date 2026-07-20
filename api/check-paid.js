const express = require("express");
const { OKXFacilitatorClient } = require("@okxweb3/x402-core");
const { ExactEvmScheme } = require("@okxweb3/x402-evm/exact/server");
const { paymentMiddleware, x402ResourceServer } = require("@okxweb3/x402-express");
const { evaluateTransaction, validateTransaction } = require("../lib/policy");

const app = express();
const network = process.env.X402_NETWORK || "eip155:1952";
const price = process.env.X402_PRICE || "$0.01";
const payTo = process.env.PAY_TO_ADDRESS || "";
const requiredCredentials = ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE"];
const missingCredentials = requiredCredentials.filter((key) => !process.env[key]);
const configured = Boolean(payTo) && missingCredentials.length === 0;

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/api/check-paid", (req, res) => {
  res.status(200).json({
    service: "TxSentinel x402 Policy Check",
    status: configured ? "ready" : "configuration_required",
    protocol: "OKX x402",
    sdk: "@okxweb3/x402-express",
    network,
    price,
    missing: configured ? [] : [...missingCredentials, ...(payTo ? [] : ["PAY_TO_ADDRESS"])]
  });
});

if (configured) {
  const facilitator = new OKXFacilitatorClient({
    apiKey: process.env.OKX_API_KEY,
    secretKey: process.env.OKX_SECRET_KEY,
    passphrase: process.env.OKX_PASSPHRASE,
    baseUrl: process.env.OKX_X402_BASE_URL,
    syncSettle: true
  });
  const resourceServer = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());

  app.use(
    paymentMiddleware(
      {
        "POST /api/check-paid": {
          accepts: { scheme: "exact", price, network, payTo },
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
      message: "The free review endpoint remains available at /api/check.",
      missing: [...missingCredentials, ...(payTo ? [] : ["PAY_TO_ADDRESS"])]
    });
  }

  const validation = validateTransaction(req.body || {});
  if (!validation.success) {
    return res.status(422).json({ ok: false, error: "INVALID_POLICY_REQUEST", issues: validation.issues });
  }

  return res.status(200).json({
    ok: true,
    protocol: "OKX x402",
    evaluatedAt: new Date().toISOString(),
    result: evaluateTransaction(validation.data)
  });
});

module.exports = app;
