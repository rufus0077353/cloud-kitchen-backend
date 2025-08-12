
// routes/pushRoutes.js
const express = require("express");
const router = express.Router();
const { PushSubscription, Vendor } = require("../models");
const { authenticateToken } = require("../middleware/authMiddleware");
const { sendPush, VAPID_PUBLIC_KEY } = require("../utils/push");

// POST /api/push/subscribe
// body: { subscription, as: "user" | "vendor" }
router.post("/subscribe", authenticateToken, async (req, res) => {
  try {
    const { subscription, as } = req.body; // subscription is the browser PushSubscription object
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ message: "Invalid subscription" });
    }
    if (!["user", "vendor"].includes(as)) {
      return res.status(400).json({ message: "Missing 'as' (user|vendor)" });
    }

    let userType = as;
    let userId   = req.user.id;

    if (as === "vendor") {
      // map logged-in user -> vendor id (if your ensureVendorProfile exists you can reuse it, here we lookup)
      const vendor = await Vendor.findOne({ where: { UserId: req.user.id } });
      if (!vendor) return res.status(403).json({ message: "Vendor profile not found" });
      userId = vendor.id;
    }

    // upsert by endpoint
    const [row] = await PushSubscription.findOrCreate({
      where: { endpoint: subscription.endpoint },
      defaults: {
        userType,
        userId,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
    });

    // If exists, update owner/type
    if (row.userId !== userId || row.userType !== userType) {
      row.userId = userId;
      row.userType = userType;
      row.keys = subscription.keys;
      await row.save();
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("subscribe error:", err);
    res.status(500).json({ message: "Failed to save subscription" });
  }
});

// DELETE /api/push/unsubscribe
router.delete("/unsubscribe", authenticateToken, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ message: "Missing endpoint" });

    await PushSubscription.destroy({ where: { endpoint } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to unsubscribe" });
  }
});

module.exports = router;