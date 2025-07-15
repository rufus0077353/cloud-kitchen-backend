
const express = require("express");
const router = express.Router();
const { Order, OrderItem, Vendor, MenuItem, User } = require("../models");
const { Op } = require("sequelize");
const { authenticateToken } = require("../middleware/authMiddleware");

/**
 * GET /api/orders/my
 * Get orders for the logged-in user
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
 * GET /api/orders/vendor/:vendorId
 * Get orders for a specific vendor
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
 */
router.post("/", async (req, res) => {
  const { UserId, VendorId, totalAmount, items } = req.body;

  if (!UserId || !VendorId || !totalAmount || !items?.length) {
    return res.status(400).json({ message: "UserId, VendorId, totalAmount and items are required" });
  }

  try {
    const order = await Order.create({ UserId, VendorId, totalAmount });

    const orderItems = items.map(item => ({
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
 */
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { totalAmount, items } = req.body;

  try {
    const order = await Order.findByPk(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (totalAmount) order.totalAmount = totalAmount;
    await order.save();

    if (items?.length) {
      await OrderItem.destroy({ where: { OrderId: id } });

      const orderItems = items.map(item => ({
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
router.delete("/:id", async (req, res) => {
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
router.get("/filter", async (req, res) => {
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
router.get("/:id/invoice", async (req, res) => {
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
        ${order.MenuItems.map(item =>
          `<li>${item.name} (x${item.OrderItem.quantity}) - ₹${item.price}</li>`
        ).join("")}
      </ul>
      <p><strong>Status:</strong> ${order.status}</p>
      <p><strong>Total Amount:</strong> ₹${order.totalAmount}</p>
    `;

    res.send(html);
  } catch (err) {
    res.status(500).json({ message: "Error generating invoice", error: err.message });
  }
});

module.exports = router;