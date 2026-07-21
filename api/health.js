module.exports = function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    service: "TxSentinel",
    status: "ready",
    version: "1.0.0",
    policyVersion: "txsentinel-1.0.0",
    endpoints: {
      preflight: "/api/preflight",
      legacyPreflight: "/api/check",
      paid: "/api/check-paid"
    }
  });
};
