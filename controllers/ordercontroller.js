const db = require("../models");
const { Order, OrderItem, MenuItem, Vendor, User } = db;
const { Op } = require("sequelize");

/* ---------------- Create ---------------- */
exports.createOrder = async (req, res) => {
  try {
    const { UserId, VendorId, totalAmount, items } = req.body;

    if (!UserId || !VendorId || !totalAmount || !items?.length) {
      return res
        .status(400)
        .json({ message: "UserId, VendorId, totalAmount, and items are required" });
    }

    const order = await Order.create({ UserId, VendorId, totalAmount });

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
};

/* ---------------- My orders (user) ---------------- */
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { UserId: req.user.id },
      include: [
        // ⬇️ include commissionRate
        { model: Vendor, attributes: ["id", "name", "cuisine", "commissionRate"] },
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
};

/* ---------------- Vendor orders (open endpoint by vendorId) ---------------- */
exports.getVendorOrders = async (req, res) => {
  try {
    const vendorId = req.params.vendorId;

    const orders = await Order.findAll({
      where: { VendorId: vendorId },
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine", "commissionRate"] },
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
};

/* ---------------- Vendor orders (secure, via middleware) ---------------- */
exports.getVendorOrdersSecure = async (req, res) => {
  try {
    const vendorId = req.vendor.id; // set by ensureVendorProfile middleware

    const orders = await Order.findAll({
      where: { VendorId: vendorId },
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine", "commissionRate"] },
        { model: OrderItem, include: [{ model: MenuItem, attributes: ["id", "name", "price"] }] },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor orders", error: err.message });
  }
};

/* ---------------- Update order (amount/items) ---------------- */
exports.updateOrder = async (req, res) => {
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
};

/* ---------------- Delete order ---------------- */
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    await OrderItem.destroy({ where: { OrderId: order.id } });
    await order.destroy();

    res.json({ message: "Order deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting order", error: err.message });
  }
};

/* ---------------- Filter (Admin) — supports GET or POST; returns {items: []} ---------------- */
exports.filterOrders = async (req, res) => {
  // allow both GET (query) and POST (body) — matches your frontend
  const src = req.method === "GET" ? req.query : req.body;
  const { UserId, VendorId, status, startDate, endDate } = src;

  const where = {};
  if (UserId) where.UserId = UserId;
  if (VendorId) where.VendorId = VendorId;
  if (status) where.status = status;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt[Op.gte] = new Date(startDate);
    if (endDate) where.createdAt[Op.lte] = new Date(endDate);
  }

  try {
    const orders = await Order.findAll({
      where,
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        // ⬇️ KEY: include commissionRate so the UI won’t fall back to 15%
        { model: Vendor, attributes: ["id", "name", "cuisine", "commissionRate"] },
        {
          model: MenuItem,
          attributes: ["id", "name", "price"],
          through: { attributes: ["quantity"] },
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Return in a shape the UI already accepts
    res.json({ items: orders });
  } catch (err) {
    res.status(500).json({ message: "Error filtering orders", error: err.message });
  }
};

/* ---------------- Update order status (vendor-owned) ---------------- */
exports.updateOrderStatus = async (req, res) => {
  try {
    const vendorId = req.vendor?.id; // set by ensureVendorProfile middleware
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ["pending", "accepted", "rejected", "ready", "delivered"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const order = await Order.findByPk(id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (vendorId && order.VendorId !== vendorId) {
      return res.status(403).json({ message: "Not your order" });
    }

    order.status = status;
    await order.save();
    res.json({ message: "Status updated", order });
  } catch (err) {
    res.status(500).json({ message: "Failed to update status", error: err.message });
  }
};


/* ---------------- Rate order ---------------- */
exports.rateOrder = async (req, res) => {
  try {
    const { id } = req.params; // order ID
    const { rating, review } = req.body;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const order = await Order.findByPk(id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.UserId !== userId)
      return res.status(403).json({ message: "You can only rate your own orders" });
    if (order.status !== "delivered")
      return res.status(400).json({ message: "You can only rate delivered orders" });

    // Update rating fields
    order.rating = rating ?? null;
    order.review = review ?? null;
    order.isRated = true;
    await order.save();

    return res.json({
      message: "Order rated successfully",
      order: {
        id: order.id,
        rating: order.rating,
        review: order.review,
        isRated: order.isRated,
      },
    });
  } catch (err) {
    console.error("rateOrder error:", err);
    res.status(500).json({ message: "Error rating order", error: err.message });
  }
};

/* ---------------- Invoice ---------------- */
exports.getInvoice = async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: [
        { model: User, attributes: ["name", "email"] },
        { model: Vendor, attributes: ["name", "cuisine", "commissionRate"] },
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
        ${order.MenuItems.map(
          (item) =>
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
};