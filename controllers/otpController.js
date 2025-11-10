
// controllers/otpController.js
const { createAndSendOtp, verifyOtp } = require("../services/otpService");

exports.sendOtp = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email is required" });

    const out = await createAndSendOtp({ email, channel: "email" });
    return res.json({ message: "OTP sent", expiresAt: out.expiresAt, debug: out.debug });
  } catch (e) {
    console.error("sendOtp failed:", e);
    res.status(500).json({ message: "Failed to send OTP" });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const otp = String(req.body.otp || "").trim();
    if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required" });

    const result = await verifyOtp({ email, otp });
    if (!result.ok) return res.status(400).json({ message: result.message });
    return res.json({ message: "Verified" });
  } catch (e) {
    console.error("verifyOtp failed:", e);
    res.status(500).json({ message: "Verification failed" });
  }
};