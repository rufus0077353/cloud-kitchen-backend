
// services/otpService.js  (CommonJS version)
const crypto = require("crypto");
const { EmailToken, User } = require("../models");
const { sendMail } = require("../services/emailService"); // keep if you're emailing OTPs

// TTL & limits
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;

// util: 6-digit OTP
function genOtp() {
  return ("" + Math.floor(100000 + Math.random() * 900000));
}

// util: sha256(email + ":" + otp)
function hash(email, otp) {
  return crypto.createHash("sha256").update(`${email}:${otp}`).digest("hex");
}

/**
 * createAndSendOtp({ email, channel })
 * - Upserts EmailToken row
 * - Sends email if channel === 'email'
 */
async function createAndSendOtp({ email, channel = "email" }) {
  const otp = genOtp();
  const otpHash = hash(email, otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // upsert token row
  const [row, created] = await EmailToken.findOrCreate({
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

  // send via email (optional SMS later)
  if (channel === "email") {
    await sendMail({
      to: email,
      subject: "Your Servezy verification code",
      html: `<p>Your verification code is <b>${otp}</b>. It expires in 5 minutes.</p>`,
      text: `Your verification code is ${otp}. It expires in 5 minutes.`,
      category: "otp",
    });
  }

  // never return the OTP to client in prod; but return a hint for testing logs
  return { success: true, expiresAt, debug: process.env.NODE_ENV !== "production" ? otp : undefined };
}

/**
 * verifyOtp({ email, otp })
 * - checks hash & expiry & attempts
 */
async function verifyOtp({ email, otp }) {
  const row = await EmailToken.findOne({ where: { email } });
  if (!row) return { ok: false, message: "OTP not found. Please request a new one." };

  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, message: "Too many attempts. Please request a new code." };
  }

  const now = Date.now();
  if (!row.expiresAt || new Date(row.expiresAt).getTime() < now) {
    return { ok: false, message: "OTP expired. Please request a new one." };
  }

  const good = row.otpHash === hash(email, otp);
  row.attempts += 1;
  await row.save();

  if (!good) return { ok: false, message: "Incorrect code." };

  // success: destroy token so it can’t be reused
  await row.destroy();
  return { ok: true };
}

module.exports = { createAndSendOtp, verifyOtp };