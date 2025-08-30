const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");
const { Order, OrderItem, Vendor, MenuItem, User } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");

// ----------------- socket helpers -----------------
function emitToVendorHelper(req, vendorId, event, payload) {
  const fn = req.emitToVendor || req.app.get("emitToVendor");
  if (typeof fn === "function") fn(vendorId, event, payload);
}
function emitToUserHelper(req, userId, event, payload) {
  const fn = req.emitToUser || req.app.get("emitToUser");
  if (typeof fn === "function") fn(userId, event, payload);
}

// ----------------- user orders -----------------
router.get("/my", authenticateToken, async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { UserId: req.user.id },
      include: [
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        { model: MenuItem, attributes: ["id", "name", "price"], through: { attributes: ["quantity"] } },
      ],
      order: [["createdAt", "DESC"]],
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error fetching user orders", error: err.message });
  }
});

// ----------------- vendor (current) orders -----------------
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
          { model: OrderItem, include: [{ model: MenuItem, attributes: ["id", "name", "price"] }] },
        ],
        order: [["createdAt", "DESC"]],
      });
      res.json(orders);
    } catch (err) {
      res.status(500).json({ message: "Error fetching vendor orders", error: err.message });
    }
  }
);

// ----------------- vendor summary (place BEFORE /vendor/:vendorId !) -----------------
router.get(
  "/vendor/summary",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      if (!req.vendor || !req.vendor.id) {
        return res.status(400).json({ message: "Vendor profile not found for this user" });
      }
      const vendorId = req.vendor.id;

      // date helpers (server TZ)
      const startOfToday = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
      const startOfWeek  = () => { const d = new Date(); const diff = (d.getDay()+6)%7; d.setHours(0,0,0,0); d.setDate(d.getDate()-diff); return d; };
      const startOfMonth = () => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(1); return d; };

      const nonRejectedWhere = { VendorId: vendorId, status: { [Op.ne]: "rejected" } };

      // lifetime
      const [totalOrders, lifetimeRevenue] = await Promise.all([
        Order.count({ where: { VendorId: vendorId } }),
        Order.sum("totalAmount", { where: nonRejectedWhere }),
      ]);

      // counts by status
      const ST = ["pending", "accepted", "ready", "delivered", "rejected"];
      const statusCounts = {};
      await Promise.all(
        ST.map(async (s) => {
          statusCounts[s] = await Order.count({ where: { VendorId: vendorId, status: s } });
        })
      );

      // periods
      const todayStart = startOfToday();
      const weekStart  = startOfWeek();
      const monthStart = startOfMonth();

      const [ordersToday, revenueToday] = await Promise.all([
        Order.count({ where: { VendorId: vendorId, createdAt: { [Op.gte]: todayStart } } }),
        Order.sum("totalAmount", { where: { ...nonRejectedWhere, createdAt: { [Op.gte]: todayStart } } }),
      ]);

      const [ordersWeek, revenueWeek] = await Promise.all([
        Order.count({ where: { VendorId: vendorId, createdAt: { [Op.gte]: weekStart } } }),
        Order.sum("totalAmount", { where: { ...nonRejectedWhere, createdAt: { [Op.gte]: weekStart } } }),
      ]);

      const [ordersMonth, revenueMonth] = await Promise.all([
        Order.count({ where: { VendorId: vendorId, createdAt: { [Op.gte]: monthStart } } }),
        Order.sum("totalAmount", { where: { ...nonRejectedWhere, createdAt: { [Op.gte]: monthStart } } }),
      ]);

      res.json({
        vendorId,
        totals:   { orders: totalOrders || 0, revenue: Number(lifetimeRevenue || 0) },
        today:    { orders: ordersToday || 0, revenue: Number(revenueToday || 0) },
        week:     { orders: ordersWeek || 0, revenue: Number(revenueWeek || 0) },
        month:    { orders: ordersMonth || 0, revenue: Number(revenueMonth || 0) },
        byStatus: statusCounts,
      });
    } catch (err) {
      console.error("GET /api/orders/vendor/summary error:", err);
      res.status(500).json({ message: "Failed to build summary", error: err.message });
    }
  }
);

// ----------------- vendor (any) orders by id -----------------
router.get("/vendor/:vendorId", authenticateToken, async (req, res) => {
  try {
    const idNum = Number(req.params.vendorId);
    if (!Number.isFinite(idNum)) return res.status(400).json({ message: "Invalid vendor id" });

    const orders = await Order.findAll({
      where: { VendorId: idNum },
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: MenuItem, attributes: ["id", "name", "price"], through: { attributes: ["quantity"] } },
      ],
      order: [["createdAt", "DESC"]],
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendor orders", error: err.message });
  }
});

// ----------------- create order (user) -----------------
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { VendorId, items } = req.body;

    const vendorIdNum = Number(VendorId);
    if (!Number.isFinite(vendorIdNum)) {
      return res.status(400).json({ message: "VendorId must be a number", got: VendorId });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "At least one item is required" });
    }

    const ids = [];
    const cleanItems = [];
    for (const it of items) {
      const mid = Number(it?.MenuItemId);
      const qty = Number(it?.quantity);
      if (!Number.isFinite(mid) || !Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({
          message: "Each item must include numeric MenuItemId and quantity (>0)",
          got: it,
        });
      }
      ids.push(mid);
      cleanItems.push({ MenuItemId: mid, quantity: qty });
    }

    const menuRows = await MenuItem.findAll({
      where: { id: ids, VendorId: vendorIdNum },
      attributes: ["id", "price", "name", "VendorId"],
    });

    const foundIds = menuRows.map((m) => Number(m.id));
    if (menuRows.length !== ids.length) {
      const missing = ids.filter((id) => !foundIds.includes(id));
      return res.status(400).json({
        message: "One or more items are invalid for this vendor (check menu item -> vendor mapping).",
        vendorId: vendorIdNum,
        requestedItemIds: ids,
        foundForVendor: foundIds,
        missingForVendor: missing,
      });
    }

    const priceMap = new Map(menuRows.map((m) => [Number(m.id), Number(m.price) || 0]));
    const computedTotal = cleanItems.reduce(
      (sum, it) => sum + (priceMap.get(it.MenuItemId) || 0) * it.quantity,
      0
    );

    const order = await Order.create({
      UserId: req.user.id,
      VendorId: vendorIdNum,
      totalAmount: computedTotal,
      status: "pending",
    });

    await OrderItem.bulkCreate(
      cleanItems.map((it) => ({
        OrderId: order.id,
        MenuItemId: it.MenuItemId,
        quantity: it.quantity,
      }))
    );

    const fullOrder = await Order.findByPk(order.id, {
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        { model: OrderItem, include: [{ model: MenuItem, attributes: ["id", "name", "price"] }] },
      ],
    });

    emitToVendorHelper(req, vendorIdNum, "order:new", fullOrder);
    emitToUserHelper(req, req.user.id, "order:new", fullOrder);

    return res.status(201).json({ message: "Order created", order: fullOrder });
  } catch (err) {
    console.error("POST /api/orders error:", err?.name, err?.message);
    if (err?.name === "SequelizeForeignKeyConstraintError") {
      return res.status(400).json({
        message: "Invalid foreign key (user/vendor/menu item mismatch). Check payload IDs.",
        error: err.message,
      });
    }
    if (err?.name === "SequelizeValidationError") {
      return res.status(400).json({ message: "Validation failed", errors: err.errors });
    }
    return res.status(500).json({ message: "Error creating order", error: err.message });
  }
});

// ----------------- update/delete/filter/invoice -----------------
router.put("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { totalAmount, items } = req.body;

  try {
    const order = await Order.findByPk(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (totalAmount !== undefined) order.totalAmount = totalAmount;
    await order.save();

    if (Array.isArray(items) && items.length) {
      await OrderItem.destroy({ where: { OrderId: id } });
      await OrderItem.bulkCreate(items.map((it) => ({
        OrderId: id,
        MenuItemId: it.MenuItemId,
        quantity: it.quantity,
      })));
    }
    res.json({ message: "Order updated successfully", order });
  } catch (err) {
    res.status(500).json({ message: "Error updating order", error: err.message });
  }
});

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

router.get("/filter", authenticateToken, async (req, res) => {
  const { UserId, VendorId, status, startDate, endDate } = req.query;

  const where = {};
  if (UserId) where.UserId = UserId;
  if (VendorId) where.VendorId = VendorId;
  if (status) where.status = status;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt[Op.gte] = new Date(startDate);
    if (endDate)   where.createdAt[Op.lte] = new Date(endDate);
  }

  try {
    const orders = await Order.findAll({
      where,
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        { model: MenuItem, attributes: ["id", "name", "price"], through: { attributes: ["quantity"] } },
      ],
      order: [["createdAt", "DESC"]],
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error filtering orders", error: err.message });
  }
});

router.get("/:id/invoice", authenticateToken, async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: [
        { model: User, attributes: ["name", "email"] },
        { model: Vendor, attributes: ["name", "cuisine"] },
        { model: MenuItem, attributes: ["name", "price"], through: { attributes: ["quantity"] } },
      ],
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const html = `
      <h2>Invoice for Order #${order.id}</h2>
      <p><strong>User:</strong> ${order.User.name} (${order.User.email})</p>
      <p><strong>Vendor:</strong> ${order.Vendor.name} (${order.Vendor.cuisine})</p>
      <ul>
        ${order.MenuItems.map(item => `<li>${item.name} (x${item.OrderItem.quantity}) - ₹${item.price}</li>`).join("")}
      </ul>
      <p><strong>Status:</strong> ${order.status}</p>
      <p><strong>Total Amount:</strong> ₹${order.totalAmount}</p>
    `;
    res.send(html);
  } catch (err) {
    res.status(500).json({ message: "Error generating invoice", error: err.message });
  }
});

// ----------------- vendor updates status -----------------
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
      if (order.VendorId !== vendorId) return res.status(403).json({ message: "Not your order" });

      order.status = status;
      await order.save();

      emitToVendorHelper(req, order.VendorId, "order:status", { id: order.id, status: order.status });
      emitToUserHelper(req, order.UserId, "order:status", { id: order.id, status: order.status, UserId: order.UserId });

      res.json({ message: "Status updated", order });
    } catch (err) {
      res.status(500).json({ message: "Failed to update status", error: err.message });
    }
  }
);

module.exports = router;