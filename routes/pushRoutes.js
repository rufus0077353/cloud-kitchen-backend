// routes/pushRoutes.js
const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authMiddleware");
const { VAPID_PUBLIC_KEY, sendToSubscription } = require("../utils/push");
const { PushSubscription } = require("../models");

// Public key for the FE
router.get("/public-key", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || "" });
});

// Save/replace subscription for this user
router.post("/subscribe", authenticateToken, async (req, res) => {
  try {
    const { subscription, as = "user" } = req.body || {};
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ message: "Invalid subscription payload" });
    }

    // Upsert on endpoint (unique)
    const [row] = await PushSubscription.findOrCreate({
      where: { endpoint: subscription.endpoint },
      defaults: {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userId: req.user.id,
        roleAs: as === "vendor" ? "vendor" : "user",
      },
    });

    // Keep latest keys/user/role if endpoint exists
    if (row) {
      row.p256dh = subscription.keys.p256dh;
      row.auth   = subscription.keys.auth;
      row.userId = req.user.id;
      row.roleAs = as === "vendor" ? "vendor" : "user";
      await row.save();
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "Failed to subscribe", error: e.message });
  }
});

// Remove subscription by endpoint
router.delete("/unsubscribe", authenticateToken, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ message: "endpoint required" });
    await PushSubscription.destroy({ where: { endpoint, userId: req.user.id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "Failed to unsubscribe", error: e.message });
  }
});

/**
 * Helper to notify a user by userId (exported for other routes)
 * @param {number} userId
 * @param {object} payload { title, body, url, icon, tag }
 */
async function notifyUser(userId, payload) {
  const subs = await PushSubscription.findAll({ where: { userId } });
  for (const s of subs) {
    const res = await sendToSubscription(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload
    );
    if (!res.ok && (res.statusCode === 404 || res.statusCode === 410)) {
      // stale; delete
      try { await s.destroy(); } catch {}
    }
  }
}

module.exports = router;
module.exports.notifyUser = notifyUser;