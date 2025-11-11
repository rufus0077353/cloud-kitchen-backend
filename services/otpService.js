
// services/otpService.js
const crypto = require("crypto");
const { OtpToken } = require("../models");
const { sendMail } = require("../utils/mailer");

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const genOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const hash = (email, otp) => crypto.createHash("sha256").update(`${email}:${otp}`).digest("hex");

async function createAndSendOtp({ email, channel = "email" }) {
  const otp = genOtp();
  const otpHash = hash(email, otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const [row, created] = await OtpToken.findOrCreate({
    where: { email },
    defaults: { email, otpHash, expiresAt, attempts: 0, channel },
  });

  if (!created) {
    row.otpHash = otpHash;
    row.expiresAt = expiresAt;
    row.attempts = 0;
    row.channel = channel;
    await row.save();
  }

  if (channel === "email") {
    await sendMail({
      to: email,
      subject: "Your Servezy verification code",
      html: `<p>Your verification code is <b>${otp}</b>. It expires in 5 minutes.</p>`,
      text: `Your verification code is ${otp}. It expires in 5 minutes.`,
      category: "otp",
    });
  }

  return { success: true, expiresAt, debug: process.env.NODE_ENV !== "production" ? otp : undefined };
}

async function verifyOtp({ email, otp }) {
  const row = await OtpToken.findOne({ where: { email } });
  if (!row) return { ok: false, message: "OTP not found. Please request a new one." };

  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, message: "Too many attempts. Please request a new code." };

  if (!row.expiresAt || new Date(row.expiresAt).getTime() < Date.now()) {
    return { ok: false, message: "OTP expired. Please request a new one." };
  }

  const good = row.otpHash === hash(email, otp);
  row.attempts += 1;
  await row.save();

  if (!good) return { ok: false, message: "Incorrect code." };

  await row.destroy();
  return { ok: true };
}

module.exports = { createAndSendOtp, verifyOtp };