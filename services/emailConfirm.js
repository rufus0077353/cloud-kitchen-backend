
// services/emailConfirm.js
const crypto = require("crypto");
const { EmailConfirmToken, User } = require("../models");
const { sendMail } = require("../utils/mailer");
const { templates } = require("../utils/templates");

const trimBase = (s) => String(s || "").replace(/\/+$/, "");
const frontendBase = () => trimBase(process.env.FRONTEND_BASE_URL);
const backendBase  = () => trimBase(process.env.APP_BASE_URL);

async function sendConfirmEmail(user) {
  if (!user || !user.id || !user.email) throw new Error("user with id & email required");

  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await EmailConfirmToken.create({ userId: user.id, token, expiresAt, usedAt: null });

  const fe = frontendBase();
  const url = fe
    ? `${fe}/verify-email?token=${encodeURIComponent(token)}`
    : `${backendBase()}/api/email/confirm?token=${encodeURIComponent(token)}`;

  const { subject, html, text } = templates.confirmEmail({ name: user.name || "", url });
  return sendMail({ to: user.email, subject, html, text, category: "confirm", transactional: true });
}

async function verifyConfirmToken(token) {
  const rec = await EmailConfirmToken.findOne({ where: { token, usedAt: null } });
  if (!rec) throw new Error("invalid_token");
  if (rec.expiresAt && rec.expiresAt < new Date()) throw new Error("expired");

  await rec.update({ usedAt: new Date() });
  await User.update({ emailVerified: true }, { where: { id: rec.userId } });
  return { ok: true };
}

module.exports = { sendConfirmEmail, verifyConfirmToken };