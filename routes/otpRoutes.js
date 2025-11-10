
// src/routes/otpRoutes.js
const express = require("express");
const { authenticateToken } = require("../middleware/authMiddleware");
const { sendEmailOtp, verifyEmailOtp } = require("../services/otpService");
const router = require("./authRoutes.js");

const r = express.Router();

// POST /api/otp/email/send
r.post("/email/send", authenticateToken, async (req, res) => {
  try {
    await sendEmailOtp(req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

// POST /api/otp/email/verify
r.post("/email/verify", authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    const out = await verifyEmailOtp(req.user.id, code);
    res.json(out);
  } catch (e) { res.status(400).json({ message: e.message }); }
});

module.exports = router;