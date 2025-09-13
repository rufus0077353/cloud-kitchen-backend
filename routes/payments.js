// /server/routes/payments.js
const router = require("express").Router();
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { razorpayKeyId, razorpayKeySecret } = require("../config/payments");
const { Order } = require("../models"); // adjust path if your models are elsewhere

// Init client once
const rp = new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret });

/**
 * POST /api/payments/create
 * body: { orderId: number|string, amountInPaise: number, currency?: "INR" }
 * resp: { rzpOrder: {...} }
 */
router.post("/create", async (req, res) => {
  try {
    const { orderId, amountInPaise, currency = "INR" } = req.body || {};

    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }
    const amount = Number(amountInPaise);
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ message: "amountInPaise must be a positive integer" });
    }

    // Optional: sanity check your Order exists
    const order = await Order.findByPk(orderId).catch(() => null);
    if (!order) {
      // Not fatal if you sometimes pay for guest orders; flip to 404 if you want strictness
      console.warn(`[payments/create] Order ${orderId} not found; continuing to create RZP order`);
    }

    const receipt = `srvz_${orderId}_${Date.now()}`;
    const rzpOrder = await rp.orders.create({ amount, currency, receipt });

    return res.json({ rzpOrder });
  } catch (err) {
    console.error("[payments/create] error:", err);
    return res.status(500).json({ message: "Failed to create Razorpay order" });
  }
});

/**
 * POST /api/payments/verify
 * body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, appOrderId }
 * resp: { ok: true, order?: {...} }
 */
router.post("/verify", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      appOrderId,
    } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !appOrderId) {
      return res.status(400).json({ ok: false, message: "Missing verification fields" });
    }

    const expected = crypto
      .createHmac("sha256", razorpayKeySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(400).json({ ok: false, message: "Signature mismatch" });
    }

    // Update your app order
    await Order.update(
      {
        status: "PAID",
        paymentId: razorpay_payment_id,
        paymentProviderOrderId: razorpay_order_id,
      },
      { where: { id: appOrderId } }
    );

    // Optional: return the updated order
    const updated = await Order.findByPk(appOrderId).catch(() => null);

    return res.json({ ok: true, order: updated || null });
  } catch (err) {
    console.error("[payments/verify] error:", err);
    return res.status(500).json({ ok: false, message: "Payment verification failed" });
  }
});

module.exports = router;