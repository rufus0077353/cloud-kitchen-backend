
// services/otpService.js
const { sendMail } = require("../utils/mailer");
const { templates } = require("../utils/templates");

const store = new Map(); // key => { code, exp, attempts, lastSent }
const TTL_MS = 5 * 60 * 1000;
const THROTTLE_MS = 45 * 1000;
const MAX_ATTEMPTS = 6;

const keyFor = (to, purpose="login") => `${String(to).toLowerCase()}::${purpose}`;
const genCode = () => String(100000 + Math.floor(Math.random() * 900000));

async function sendOtp(to, purpose="login") {
  if (!to) throw new Error("to required");
  const k = keyFor(to, purpose);
  const now = Date.now();
  const prev = store.get(k);
  if (prev && now - prev.lastSent < THROTTLE_MS) {
    return { ok:true, throttled:true, wait: Math.ceil((THROTTLE_MS-(now-prev.lastSent))/1000) };
  }
  const code = genCode();
  store.set(k, { code, exp: now + TTL_MS, attempts: 0, lastSent: now });

  const { subject, html, text } = templates.otpEmail({ code, purpose });
  const result = await sendMail({ to, subject, html, text, category:"otp", transactional:true });
  return { ok:true, result, expiresInSec: Math.floor(TTL_MS/1000) };
}

async function verifyOtp(to, code, purpose="login") {
  const k = keyFor(to, purpose);
  const rec = store.get(k);
  if (!rec) return { ok:false, reason:"not_found" };
  if (Date.now() > rec.exp) { store.delete(k); return { ok:false, reason:"expired" }; }
  rec.attempts += 1;
  if (rec.attempts > MAX_ATTEMPTS) { store.delete(k); return { ok:false, reason:"too_many_attempts" }; }
  if (String(code) !== String(rec.code)) return { ok:false, reason:"invalid_code" };
  store.delete(k);
  return { ok:true };
}

module.exports = { sendOtp, verifyOtp };