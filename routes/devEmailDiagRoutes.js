
// routes/devEmailDiag.js
const express = require("express");
const router = express.Router();
const mailer = require("../utils/mailer");

// GET /api/dev-email/diag
router.get("/diag", (_req, res) => {
  res.json({
    provider: mailer.__diag.provider(),
    isProd: mailer.__diag.isProd(),
    from: mailer.__diag.from(),
    keyLen: mailer.__diag.keyLen(),        // length only
    keyPreview: mailer.__diag.keyPreview() // non-sensitive preview
  });
});

module.exports = router;