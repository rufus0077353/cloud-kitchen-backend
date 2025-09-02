
// src/utils/notifications.js
// Minimal, safe no-op notifications helper.
// Replace with real web-push / email / SMS later if you want.

async function notifyUser(userId, payload = {}) {
  // You can integrate web-push/email here. For now we just log.
  try {
    const { title, body, url, tag } = payload || {};
    console.log(
      `[notifyUser] userId=${userId} title="${title || ""}" body="${body || ""}" url="${url || ""}" tag="${tag || ""}"`
    );
  } catch (e) {
    console.warn("notifyUser failed (noop):", e?.message || e);
  }
}

module.exports = { notifyUser };