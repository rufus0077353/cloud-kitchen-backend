
// services/marketingService.js
const crypto = require("crypto");
const { Subscriber } = require("../models");
const { sendMail } = require("../utils/mailer");
const { templates } = require("../utils/templates");

/**
 * Send a marketing email campaign to all active subscribers.
 */
async function sendCampaign({ title, bodyHtml }) {
  const subs = await Subscriber.findAll({ where: { unsubAt: null } });
  const base = process.env.APP_BASE_URL || "https://servezy.in";

  const jobs = subs.map(async (s) => {
    const unsubscribeUrl = `${base}/unsubscribe?token=${encodeURIComponent(s.token)}`;
    const { subject, html, text } = templates.marketing({
      title,
      body: bodyHtml,
      unsubscribeUrl,
    });

    return sendMail({
      to: s.email,
      subject,
      html,
      text,
      category: "marketing",
      transactional: false,
      listUnsubURL: unsubscribeUrl,
    });
  });

  return Promise.allSettled(jobs);
}

/**
 * Unsubscribe a user by token.
 */
async function unsubscribeByToken(token) {
  const s = await Subscriber.findOne({ where: { token } });
  if (!s) throw new Error("Invalid token");
  if (!s.unsubAt) await s.update({ unsubAt: new Date() });
  return { ok: true };
}

module.exports = { sendCampaign, unsubscribeByToken };