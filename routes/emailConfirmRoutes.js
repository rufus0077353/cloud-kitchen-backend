
// routes/emailConfirmRoutes.js
const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authMiddleware");
const { sendConfirmEmail, verifyConfirmToken } = require("../services/emailConfirm");
const { User } = require("../models");

// Send me a confirm email (needs auth)
router.post("/email/trigger", authenticateToken, async (req, res) => {
  try {
    const me = await User.findByPk(req.user.id);
    if (!me) return res.status(404).json({ message: "User not found" });
    if (!me.email) return res.status(400).json({ message: "User has no email" });
    const result = await sendConfirmEmail(me);
    res.json({ ok:true, result });
  } catch (e) {
    res.status(500).json({ message: "Failed to send confirmation email", error: e.message });
  }
});

// Public confirm endpoint (works for FE link or fallback)
router.get("/email/confirm", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).json({ message: "token required" });
    const out = await verifyConfirmToken(token);
    res.json({ ok:true, ...out });
  } catch (e) {
    res.status(400).json({ ok:false, reason: e.message || "verify_failed" });
  }
});

module.exports = router;