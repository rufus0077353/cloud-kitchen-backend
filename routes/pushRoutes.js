// routes/pushRoutes.js
const express = require("express");
const router = express.Router();
const { Vendor, PushSubscription } = require("../models");
const { authenticateToken } = require("../middleware/authMiddleware");
const { sendPush } = require("../utils/push");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";

// --- Public key endpoint (so FE can fetch it) ---
router.get("/public-key", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe
// body: { subscription, as: "user" | "vendor" }
router.post("/subscribe", authenticateToken, async (req, res) => {
  try {
    const { subscription, as } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ message: "Invalid subscription" });
    }
    if (!["user", "vendor"].includes(as)) {
      return res.status(400).json({ message: "Missing 'as' (user|vendor)" });
    }

    let ownerType = as;
    let ownerId = req.user.id;

    if (as === "vendor") {
      const vendor = await Vendor.findOne({ where: { UserId: req.user.id } });
      if (!vendor) return res.status(403).json({ message: "Vendor profile not found" });
      ownerId = vendor.id;
    }

    const [row, created] = await PushSubscription.findOrCreate({
      where: { endpoint: subscription.endpoint },
      defaults: {
        userType: ownerType,
        userId: ownerId,
        endpoint: subscription.endpoint,
        keys: subscription.keys, // store JSON { p256dh, auth }
      },
    });

    if (!created) {
      row.userType = ownerType;
      row.userId = ownerId;
      row.keys = subscription.keys;
      await row.save();
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("subscribe error:", err);
    res.status(500).json({ message: "Failed to save subscription" });
  }
});

// DELETE /api/push/unsubscribe  body: { endpoint }
router.delete("/unsubscribe", authenticateToken, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ message: "Missing endpoint" });
    await PushSubscription.destroy({ where: { endpoint } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to unsubscribe" });
  }
});


// (optional) send a test push to a raw subscription JSON (for manual testing)
router.post("/test", async (req, res) => {
  try {
    await sendPush(req.body, { title: "Servezy", body: "Push test" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "Failed to send", error: e.message });
  }
});

module.exports = router;
