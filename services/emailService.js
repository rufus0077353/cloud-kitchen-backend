
// services/emailService.js
const FROM = process.env.EMAIL_FROM || "no-reply@servezy.in";

let sg = null;
try {
  sg = require("@sendgrid/mail");
  if (process.env.SENDGRID_API_KEY) {
    sg.setApiKey(process.env.SENDGRID_API_KEY);
  }
} catch (e) {
  console.warn("⚠️ SendGrid not installed — fallback to console email logging.");
}

/**
 * sendMail({ to, subject, html, text, category })
 * Uses SendGrid if available, else logs to console.
 */
async function sendMail({ to, subject, html, text, category = "transactional" }) {
  const recipients = Array.isArray(to) ? to : [to];

  if (sg && process.env.SENDGRID_API_KEY) {
    const msg = {
      to: recipients,
      from: FROM,
      subject,
      html,
      text,
      categories: [category],
    };

    await sg.send(msg);
    console.log("✅ Email sent to:", recipients.join(", "));
    return { ok: true };
  }

  // Fallback for dev/local
  console.log("📨 Mock email:");
  console.log("To:", recipients);
  console.log("Subject:", subject);
  console.log("Body:", text || html);
  return { ok: true, provider: "console" };
}

module.exports = { sendMail };