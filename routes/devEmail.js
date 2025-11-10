
// routes/devEmail.js (CommonJS)
const express = require("express");
const router = express.Router();
const { sendMail } = require("../utils/mailer");

// quick health
router.get("/ping", (req, res) => res.json({ ok: true, t: Date.now() }));

// POST /api/dev-email/send
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

    return res.json({ ok: true, result });
  } catch (err) {
    console.error("dev-email/send error:", err);
    return res.status(500).json({ message: "Email send failed", error: err.message });
  }
});

module.exports = router;