
const express = require("express");
const router = express.Router();
const { sendMail } = require("../utils/mailer");

// Simple developer test route
router.post("/send", async (req, res) => {
  try {
    const { to, subject, message } = req.body;
    if (!to || !subject || !message)
      return res.status(400).json({ message: "Missing fields" });

    const html = `<p>${message}</p>`;
    const text = message;

    const info = await sendMail({
      to,
      subject,
      html,
      text,
      category: "dev-test",
      transactional: true,
    });

    res.json({ ok: true, info });
  } catch (err) {
    console.error("Email send failed:", err);
    res.status(500).json({ message: err.message || "Send failed" });
  }
});

module.exports = router;