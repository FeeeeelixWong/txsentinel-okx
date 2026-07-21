const { createPreflightHandler } = require("../lib/preflight");

// Keep the original ASP review URL working while directing new integrations to /api/preflight.
module.exports = createPreflightHandler({ legacy: true });
