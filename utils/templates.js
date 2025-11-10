
// utils/templates.js  (CommonJS)
const baseStyles = `
  body{margin:0;padding:0;background:#f6f7f9;font-family:Inter,Arial,Helvetica,sans-serif}
  .wrap{max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #eef0f3;border-radius:10px;overflow:hidden}
  .head{padding:18px 22px;background:#0b6bcb;color:#fff;font-weight:700;font-size:18px}
  .body{padding:22px;color:#111827;font-size:14px;line-height:1.6}
  .btn{display:inline-block;padding:10px 16px;border-radius:8px;background:#0b6bcb;color:#fff;text-decoration:none;font-weight:600}
  .muted{color:#6b7280;font-size:12px}
`;
function shell({ title, content }) {
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>${baseStyles}</style></head>
  <body><div class="wrap"><div class="head">${title}</div>
  <div class="body">${content}
  <p class="muted" style="margin-top:20px">If you didn’t request this, you can safely ignore this email.</p>
  </div></div></body></html>`;
}

function confirmEmail({ name = "there", url }) {
  const title = "Verify your email";
  const content = `
    <p>Hi ${name},</p>
    <p>Thanks for signing up with <strong>Servezy</strong>. Please verify your email address to activate your account.</p>
    <p><a class="btn" href="${url}" target="_blank" rel="noopener">Verify Email</a></p>
    <p class="muted">Or copy this link into your browser:<br>${url}</p>`;
  const html = shell({ title, content });
  const text = `Hi ${name},\n\nPlease verify your email address:\n${url}\n\nIf you didn’t request this, ignore this email.`;
  return { subject: "Verify your email", html, text };
}

function otpEmail({ code, purpose = "verification" }) {
  const title = "Your verification code";
  const content = `
    <p>Use this code to complete ${purpose}:</p>
    <p style="font-size:28px;letter-spacing:6px;font-weight:700">${String(code || "").padStart(6,"0")}</p>
    <p class="muted">The code expires in 10 minutes.</p>`;
  const html = shell({ title, content });
  const text = `Your ${purpose} code: ${code} (expires in 10 minutes).`;
  return { subject: "Your verification code", html, text };
}

function resetPassword({ url }) {
  const title = "Reset your password";
  const content = `
    <p>Click the button below to reset your Servezy password.</p>
    <p><a class="btn" href="${url}" target="_blank" rel="noopener">Reset Password</a></p>
    <p class="muted">If you didn’t request a reset, ignore this email.</p>`;
  const html = shell({ title, content });
  const text = `Reset your Servezy password: ${url}`;
  return { subject: "Reset your password", html, text };
}

function marketing({ title = "Hello from Servezy", body = "" }) {
  const html = shell({ title, content: `<p>${body}</p>` });
  const text = `${title}\n\n${body}`;
  return { subject: title, html, text };
}

module.exports = { templates: { confirmEmail, otpEmail, resetPassword, marketing } };