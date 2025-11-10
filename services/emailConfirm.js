
// services/emailConfirm.js
const crypto = require("crypto");
const { EmailToken, User } = require("../models");
const { sendMail } = require("./emailService");
const { templates } = require("../utils/templates");

/**
 * Sends a confirmation email to the given user.
 */
async function sendConfirmEmail(user) {
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await EmailToken.create({ userId: user.id, token, expiresAt });

  const url = `${process.env.APP_BASE_URL || "https://servezy.in"}/verify-email?token=${token}`;
  const { subject, html, text } = templates.confirmEmail({
    name: user.name,
    url,
  });

  await sendMail({
    to: user.email,
    subject,
    html,
    text,
    category: "confirm",
    transactional: true,
  });
}

/**
 * Verifies an email confirmation token and activates the user’s email.
 */
async function verifyConfirmToken(token) {
  const rec = await EmailToken.findOne({ where: { token, usedAt: null } });
  if (!rec) throw new Error("Invalid token");
  if (rec.expiresAt < new Date()) throw new Error("Token expired");

  await rec.update({ usedAt: new Date() });
  await User.update({ emailVerified: true }, { where: { id: rec.userId } });

  return { ok: true };
}

module.exports = { sendConfirmEmail, verifyConfirmToken };