
// routes/devEmail.js
const express = require("express");
const router = express.Router();
const { sendMail } = require("../utils/mailer");

// GET /api/dev-email/ping
router.get("/ping", (_req, res) => res.json({ ok: true, t: Date.now() }));

router.post("/send", async (req, res) => {
  try {
    const { to, subject, message } = req.body || {};
    if (!to || !subject || !message) {
      return res.status(400).json({ message: "to, subject, message are required" });
    }

    const result = await sendMail({
      to,
      subject,
      html: `<p>${String(message)}</p>`,
      text: String(message),
      category: "dev-test",
      transactional: true,
    });

    if (!result?.ok) {
      return res.status(result.status || 500).json({
        message: "Email send failed",
        error: result.code || "sendgrid_error",
        details: result.errors || undefined,
      });
    }

    return res.json({ ok: true, result });
  } catch (err) {
    console.error("dev-email/send error:", err);
    return res.status(500).json({ message: "Email send failed", error: String(err?.message || err) });
  }
});


module.exports = router;