
// routes/devEmailDiagRoutes.js
const express = require("express");
const router = express.Router();
const mailer = require("../utils/mailer");
const sg = require("@sendgrid/mail");

router.get("/diag", (_req, res) => {
  res.json({
    provider: mailer.__diag.provider(),
    isProd: mailer.__diag.isProd(),
    from: mailer.__diag.from(),
    keyLen: mailer.__diag.keyLen(),
    keyPreview: mailer.__diag.keyPreview(),
  });
});

router.get("/check", async (_req, res) => {
  try {
    // this uses the same key your mailer set during startup
    const [resp] = await sg.request({ method: "GET", url: "/v3/user/account" });
    return res.status(resp.statusCode).json({ ok: true, status: resp.statusCode, body: resp.body });
  } catch (e) {
    return res.status(e.code || 500).json({
      ok: false,
      code: e.code || 500,
      body: e.response?.body || { message: e.message },
    });
  }
});

module.exports = router;