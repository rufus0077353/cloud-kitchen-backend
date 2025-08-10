
// routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const { Order, OrderItem, Vendor, MenuItem, User } = require("../models");
const { Op } = require("sequelize");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");

/**
 * GET /api/orders/my
 * Orders for the logged-in user
 */
router.get("/my", authenticateToken, async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { UserId: req.user.id },
      include: [
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        {
          model: MenuItem,
          attributes: ["id", "name", "price"],
          through: { attributes: ["quantity"] },
        },
      ],
      order: [["createdAt", "DESC"]],
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error fetching user orders", error: err.message });
  }
});

/**
 * GET /api/orders/vendor
 * Orders for the logged-in vendor (secure; derives VendorId from token)
 */
router.get(
  "/vendor",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const vendorId = req.vendor.id;
      const orders = await Order.findAll({
        where: { VendorId: vendorId },
        include: [
          { model: User, attributes: ["id", "name", "email"] },
          {
            // Either OrderItems w/ MenuItem...
            model: OrderItem,
            include: [{ model: MenuItem, attributes: ["id", "name", "price"] }],
          },
        ],
        order: [["createdAt", "DESC"]],
      });
      res.json(orders);
    } catch (err) {
      res.status(500).json({ message: "Error fetching vendor orders", error: err.message });
    }
  }
);

/**
 * (Optional) GET /api/orders/vendor/:vendorId
 * Orders for a specific vendor id (keep only if you need it)
 */
router.get("/vendor/:vendorId", authenticateToken, async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { VendorId: req.params.vendorId },
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        {
          model: MenuItem,
          attributes: ["id", "name", "price"],
          through: { attributes: ["quantity"] },
        },
      ],
      order: [["createdAt", "DESC"]],
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendor orders", error: err.message });
  }
});

/**
 * POST /api/orders
 * Create a new order with associated order items
 * - Takes UserId from JWT (req.user.id)
 * - Recalculates total on the server from menu item prices
 */
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { VendorId, items } = req.body;

    if (!VendorId || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ message: "VendorId and non-empty items are required" });
    }

    // Validate items and collect MenuItem IDs
    const ids = [];
    for (const it of items) {
      if (
        !it ||
        typeof it.MenuItemId !== "number" ||
        typeof it.quantity !== "number" ||
        it.quantity <= 0
      ) {
        return res.status(400).json({
          message:
            "Each item must include a valid MenuItemId (number) and quantity (>0)",
        });
      }
      ids.push(it.MenuItemId);
    }

    // Fetch prices, compute total server-side
    const menuRows = await MenuItem.findAll({
      where: { id: ids, VendorId }, // also ensure items belong to the same vendor
      attributes: ["id", "price"],
    });

    if (menuRows.length !== ids.length) {
      return res
        .status(400)
        .json({ message: "One or more menu items are invalid for this vendor" });
    }

    const priceMap = new Map(menuRows.map((m) => [m.id, m.price]));
    const computedTotal = items.reduce((sum, it) => {
      const price = priceMap.get(it.MenuItemId) || 0;
      return sum + price * it.quantity;
    }, 0);

    // Create order with computed total
    const order = await Order.create({
      UserId: req.user.id,
      VendorId,
      totalAmount: computedTotal,
      status: "pending",
    });

    // Persist order items
    const orderItems = items.map((item) => ({
      OrderId: order.id,
      MenuItemId: item.MenuItemId,
      quantity: item.quantity,
    }));
    await OrderItem.bulkCreate(orderItems);

    res.status(201).json({ message: "Order created", order });
  } catch (err) {
    res.status(500).json({ message: "Error creating order", error: err.message });
  }
});

/**
 * PUT /api/orders/:id
 * Update order totalAmount and order items
 * (Keeps your original behavior; if items change, recalculation can be added if you want)
 */
router.put("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { totalAmount, items } = req.body;

  try {
    const order = await Order.findByPk(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (totalAmount !== undefined) order.totalAmount = totalAmount;
    await order.save();

    if (items?.length) {
      await OrderItem.destroy({ where: { OrderId: id } });

      const orderItems = items.map((item) => ({
        OrderId: id,
        MenuItemId: item.MenuItemId,
        quantity: item.quantity,
      }));

      await OrderItem.bulkCreate(orderItems);
    }

    res.json({ message: "Order updated successfully", order });
  } catch (err) {
    res.status(500).json({ message: "Error updating order", error: err.message });
  }
});

/**
 * DELETE /api/orders/:id
 * Delete an order and associated order items
 */
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    await OrderItem.destroy({ where: { OrderId: order.id } });
    await order.destroy();

    res.json({ message: "Order deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting order", error: err.message });
  }
});

/**
 * GET /api/orders/filter
 * Filter orders by UserId, VendorId, status, and date range
 */
router.get("/filter", authenticateToken, async (req, res) => {
  const { UserId, VendorId, status, startDate, endDate } = req.query;

  const whereClause = {};
  if (UserId) whereClause.UserId = UserId;
  if (VendorId) whereClause.VendorId = VendorId;
  if (status) whereClause.status = status;
  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt[Op.gte] = new Date(startDate);
    if (endDate) whereClause.createdAt[Op.lte] = new Date(endDate);
  }

  try {
    const orders = await Order.findAll({
      where: whereClause,
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        {
          model: MenuItem,
          attributes: ["id", "name", "price"],
          through: { attributes: ["quantity"] },
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error filtering orders", error: err.message });
  }
});

/**
 * GET /api/orders/:id/invoice
 * Generate an HTML invoice for a specific order
 */
router.get("/:id/invoice", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const order = await Order.findByPk(id, {
      include: [
        { model: User, attributes: ["name", "email"] },
        { model: Vendor, attributes: ["name", "cuisine"] },
        {
          model: MenuItem,
          attributes: ["name", "price"],
          through: { attributes: ["quantity"] },
        },
      ],
    });

    if (!order) return res.status(404).json({ message: "Order not found" });

    const html = `
      <h2>Invoice for Order #${order.id}</h2>
      <p><strong>User:</strong> ${order.User.name} (${order.User.email})</p>
      <p><strong>Vendor:</strong> ${order.Vendor.name} (${order.Vendor.cuisine})</p>
      <ul>
        ${order.MenuItems
          .map(
            (item) =>
              `<li>${item.name} (x${item.OrderItem.quantity}) - ₹${item.price}</li>`
          )
          .join("")}
      </ul>
      <p><strong>Status:</strong> ${order.status}</p>
      <p><strong>Total Amount:</strong> ₹${order.totalAmount}</p>
    `;

    res.send(html);
  } catch (err) {
    res.status(500).json({ message: "Error generating invoice", error: err.message });
  }
});

/**
 * PATCH /api/orders/:id/status
 * Vendor updates order status (accepted/rejected/ready/delivered)
 */
router.patch(
  "/:id/status",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const vendorId = req.vendor.id;
      const { id } = req.params;
      const { status } = req.body;

      const allowed = ["pending", "accepted", "rejected", "ready", "delivered"];
      if (!allowed.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const order = await Order.findByPk(id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.VendorId !== vendorId) {
        return res.status(403).json({ message: "Not your order" });
      }

      order.status = status;
      await order.save();

      res.json({ message: "Status updated", order });
    } catch (err) {
      res.status(500).json({ message: "Failed to update status", error: err.message });
    }
  }
);

module.exports = router;