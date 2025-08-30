// routes/paymentRoutes.js
const express = require("express");
const router = express.Router();
const { Order, Vendor, User, MenuItem, OrderItem } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");

// ---------- Socket helpers (same pattern as other routes) ----------
function emitToVendorHelper(req, vendorId, event, payload) {
  const fn = req.emitToVendor || req.app.get("emitToVendor");
  if (typeof fn === "function") fn(vendorId, event, payload);
}
function emitToUserHelper(req, userId, event, payload) {
  const fn = req.emitToUser || req.app.get("emitToUser");
  if (typeof fn === "function") fn(userId, event, payload);
}

/**
 * POST /api/payments/mock/start
 * Body: { orderId }
 * User can move paymentStatus -> 'processing' (from 'unpaid')
 */
router.post("/mock/start", authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.body || {};
    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.UserId !== req.user.id) return res.status(403).json({ message: "Not your order" });
    if (order.paymentStatus === "paid") return res.status(400).json({ message: "Order already paid" });

    // Allow for mock_online (and optionally cod to simulate) — adjust if you want stricter checks
    if (!["mock_online", "cod"].includes(order.paymentMethod)) {
      return res.status(400).json({ message: `Cannot mock-start payment for method: ${order.paymentMethod}` });
    }

    order.paymentStatus = "processing";
    await order.save();

    emitToUserHelper(req, order.UserId, "payment:processing", { orderId: order.id });
    emitToVendorHelper(req, order.VendorId, "payment:processing", { orderId: order.id });

    res.json({ message: "Mock payment started", orderId: order.id, status: order.paymentStatus });
  } catch (err) {
    res.status(500).json({ message: "Failed to start mock payment", error: err.message });
  }
});

/**
 * POST /api/payments/mock/succeed
 * Body: { orderId }
 * User marks paymentStatus -> 'paid'
 */
router.post("/mock/succeed", authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.body || {};
    const order = await Order.findByPk(orderId, {
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        { model: OrderItem, include: [{ model: MenuItem, attributes: ["id", "name", "price"] }] },
      ],
    });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.UserId !== req.user.id) return res.status(403).json({ message: "Not your order" });
    if (order.paymentStatus === "paid") return res.status(400).json({ message: "Order already paid" });

    order.paymentStatus = "paid";
    order.paidAt = new Date();
    await order.save();

    emitToUserHelper(req, order.UserId, "payment:success", { orderId: order.id, paymentStatus: "paid" });
    emitToVendorHelper(req, order.VendorId, "payment:success", { orderId: order.id, paymentStatus: "paid" });

    res.json({ message: "Mock payment succeeded", order });
  } catch (err) {
    res.status(500).json({ message: "Failed to complete mock payment", error: err.message });
  }
});

/**
 * POST /api/payments/mock/fail
 * Body: { orderId }
 * User marks paymentStatus -> 'failed'
 */
router.post("/mock/fail", authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.body || {};
    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.UserId !== req.user.id) return res.status(403).json({ message: "Not your order" });
    if (order.paymentStatus === "paid") return res.status(400).json({ message: "Order already paid" });

    order.paymentStatus = "failed";
    await order.save();

    emitToUserHelper(req, order.UserId, "payment:failed", { orderId: order.id, paymentStatus: "failed" });
    emitToVendorHelper(req, order.VendorId, "payment:failed", { orderId: order.id, paymentStatus: "failed" });

    res.json({ message: "Mock payment failed", orderId: order.id, status: order.paymentStatus });
  } catch (err) {
    res.status(500).json({ message: "Failed to fail mock payment", error: err.message });
  }
});

/**
 * PATCH /api/payments/:orderId/mark-paid
 * Vendor-only: mark a COD order as paid
 */
router.patch(
  "/:orderId/mark-paid",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const vendorId = req.vendor.id;

      const order = await Order.findByPk(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.VendorId !== vendorId) return res.status(403).json({ message: "Not your order" });

      // Only for COD and not yet paid
      if (order.paymentMethod !== "cod") {
        return res.status(400).json({ message: "Only COD orders can be marked paid by vendor" });
      }
      if (order.paymentStatus === "paid") {
        return res.json({ message: "Already paid", order });
      }
      if (order.paymentStatus && !["unpaid", "processing", "failed"].includes(order.paymentStatus)) {
        return res.status(400).json({ message: `Cannot mark '${order.paymentStatus}' as paid` });
      }

      order.paymentStatus = "paid";
      order.paidAt = new Date();
      await order.save();

      emitToVendorHelper(req, order.VendorId, "payment:status", { orderId: order.id, paymentStatus: "paid" });
      emitToUserHelper(req, order.UserId, "payment:status", { orderId: order.id, paymentStatus: "paid" });

      res.json({ message: "Payment marked as paid", order });
    } catch (err) {
      console.error("PATCH /payments/:orderId/mark-paid error:", err);
      res.status(500).json({ message: "Failed to mark paid", error: err.message });
    }
  }
);

/**
 * PATCH /api/payments/:orderId/refund
 * Vendor-only: mark a PAID order as refunded (optional)
 */
router.patch(
  "/:orderId/refund",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const vendorId = req.vendor.id;

      const order = await Order.findByPk(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.VendorId !== vendorId) return res.status(403).json({ message: "Not your order" });

      if (order.paymentStatus !== "paid") {
        return res.status(400).json({ message: "Only paid orders can be refunded" });
      }

      order.paymentStatus = "refunded";
      await order.save();

      emitToVendorHelper(req, order.VendorId, "payment:status", { orderId: order.id, paymentStatus: "refunded" });
      emitToUserHelper(req, order.UserId, "payment:status", { orderId: order.id, paymentStatus: "refunded" });

      res.json({ message: "Order refunded", order });
    } catch (err) {
      console.error("PATCH /payments/:orderId/refund error:", err);
      res.status(500).json({ message: "Failed to refund", error: err.message });
    }
  }
);

module.exports = router;