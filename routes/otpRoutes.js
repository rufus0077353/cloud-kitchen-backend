
// routes/otpRoutes.js
const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authMiddleware");
const { sendOtp, verifyOtp } = require("../services/otpService");

// POST /api/otp/send   { to, purpose? }
router.post("/send", async (req, res) => {
  try {
    let { to, purpose = "login" } = req.body || {};
    if (!to && req.user) to = req.user.email; // optional if you mount with auth
    if (!to) return res.status(400).json({ message: "to is required" });
    const out = await sendOtp(to, purpose);
    res.json({ ok:true, ...out });
  } catch (e) {
    res.status(500).json({ message: "OTP send failed", error: e.message });
  }
});

// POST /api/otp/verify { to, code, purpose? }
router.post("/verify", async (req, res) => {
  try {
    let { to, code, purpose = "login" } = req.body || {};
    if (!to && req.user) to = req.user.email;
    if (!to || !code) return res.status(400).json({ message: "to & code required" });
    const out = await verifyOtp(to, code, purpose);
    if (!out.ok) return res.status(400).json(out);
    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ message: "OTP verify failed", error: e.message });
  }
});

module.exports = router;