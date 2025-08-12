// backend/utils/push.js
const webpush = require("web-push");
const { PushSubscription } = require("../models");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn("⚠️  Missing VAPID keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env");
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:admin@servezy.in",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

async function sendPush(subscription, payloadObj) {
  try {
    const payload = JSON.stringify(payloadObj || {});
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (err) {
    // 410 Gone / 404 Not Found → remove dead subscription
    if (err?.statusCode === 410 || err?.statusCode === 404) {
      try {
        await PushSubscription.destroy({ where: { endpoint: subscription.endpoint } });
      } catch (e) {}
    }
    console.error("sendPush error:", err?.statusCode, err?.body || err?.message);
    return false;
  }
}

/** Send to all subscriptions for a given userId */
async function sendToUser(userId, payloadObj) {
  const subs = await PushSubscription.findAll({ where: { UserId: userId } });
  for (const s of subs) {
    await sendPush(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payloadObj
    );
  }
}

module.exports = {
  sendPush,
  sendToUser,
  VAPID_PUBLIC_KEY,
};