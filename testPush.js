// testPush.js
const { PushSubscription } = require("./models");
const { sendPush } = require("./utils/push");

(async () => {
  const subs = await PushSubscription.findAll();
  console.log(`Found ${subs.length} subscriptions`);

  for (const s of subs) {
    await sendPush(
      {
        endpoint: s.endpoint,
        keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }
      },
      {
        title: "Test Notification 🎉",
        body: "Push works! This is a test message from the backend.",
        url: "/orders"
      }
    );
  }

  console.log("Done.");
  process.exit(0);
})();