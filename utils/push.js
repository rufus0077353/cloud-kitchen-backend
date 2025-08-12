
const webpush = require("web-push");
const { PushSubscription } = require("../models");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@servezy.in";

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn("⚠️  Missing VAPID keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env");
} else {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

async function sendPush(subscription, payloadObj) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  try {
    const payload = JSON.stringify(payloadObj || {});
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (err) {
    // remove dead subscriptions
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      try { await PushSubscription.destroy({ where: { endpoint: subscription.endpoint } }); } catch {}
    }
    console.error("push error:", err?.statusCode, err?.body || err?.message);
    return false;
  }
}

module.exports = { VAPID_PUBLIC_KEY, sendPush };