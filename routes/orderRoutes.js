
// backend/routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");

const {
  IdempotencyKey,
  Order,
  OrderItem,
  Vendor,
  MenuItem,
  User,
} = require("../models");

const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");
const sequelize = Order.sequelize;
const { notifyUser } = require("../utils/notifications");

/* ---------- config / optional deps ---------- */
const COMMISSION_PCT = Number(process.env.COMMISSION_PCT || 0.15);
let Puppeteer = null; try { Puppeteer = require("puppeteer"); } catch {}

/* ----------------- socket helpers ----------------- */
function emitToVendorHelper(req, vendorId, event, payload) {
  const fn = req.emitToVendor || req.app.get("emitToVendor");
  if (typeof fn === "function") fn(vendorId, event, payload);
}
function emitToUserHelper(req, userId, event, payload) {
  const fn = req.emitToUser || req.app.get("emitToUser");
  if (typeof fn === "function") fn(userId, event, payload);
}

/* ----------------- safe inline audit logger ----------------- */
async function audit(req, { action, order = null, details = {} }) {
  try {
    const { AuditLog } = require("../models");
    if (!AuditLog || typeof AuditLog.create !== "function") return;
    await AuditLog.create({
      userId: req.user?.id ?? null,
      vendorId: order?.VendorId ?? null,
      action,
      details: {
        orderId: order?.id ?? null,
        status: order?.status ?? null,
        ...details,
      },
    });
  } catch (e) {
    console.warn("AuditLog skipped:", e?.message || e);
  }
}

/* ----------------- helpers ----------------- */
function parsePageParams(q) {
  // page=0 => no pagination (legacy mode)
  const pageRaw = Number(q.page);
  const page = Number.isFinite(pageRaw) ? Math.max(0, pageRaw) : 0;
  const pageSizeRaw = Number(q.pageSize);
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.min(100, Math.max(1, pageSizeRaw))
    : 20;
  return { page, pageSize };
}

// ---- idempotency helpers (safe if table/model missing) ----
const isMissingTableError = (err) =>
  !!(err?.original?.code === "42P01" || /no such table|does not exist/i.test(err?.message || ""));

async function safeFindIdempotencyKey(key, userId, t) {
  if (!key || !IdempotencyKey || typeof IdempotencyKey.findOne !== "function") return null;
  try {
    return await IdempotencyKey.findOne({ where: { key, userId }, transaction: t });
  } catch (err) {
    if (isMissingTableError(err)) return null; // table not migrated: ignore idempotency
    throw err;
  }
}

async function safeCreateIdempotencyKey(record, t) {
  if (!IdempotencyKey || typeof IdempotencyKey.create !== "function") return;
  try {
    await IdempotencyKey.create(record, { transaction: t });
  } catch (err) {
    if (isMissingTableError(err)) return; // ignore if table missing
    throw err;
  }
}

/* ----------------- user orders (optionally paginated) ----------------- */
router.get("/my", authenticateToken, async (req, res) => {
  try {
    const { page, pageSize } = parsePageParams(req.query);

    if (page > 0) {
      const { count, rows } = await Order.findAndCountAll({
        where: { UserId: req.user.id },
        include: [
          { model: Vendor, attributes: ["id", "name", "cuisine"] },
          { model: MenuItem, attributes: ["id", "name", "price"], through: { attributes: ["quantity"] } },
        ],
        order: [["createdAt", "DESC"]],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return res.json({
        items: rows,
        total: count,
        page,
        pageSize,
        totalPages: Math.ceil(count / pageSize),
      });
    }

    // legacy (no pagination)
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

/* ----------------- vendor (current) orders — optionally paginated ----------------- */
router.get(
  "/vendor",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const vendorId = req.vendor.id;
      const { page, pageSize } = parsePageParams(req.query);

      if (page > 0) {
        const { count, rows } = await Order.findAndCountAll({
          where: { VendorId: vendorId },
          include: [
            { model: User, attributes: ["id", "name", "email"] },
            { model: OrderItem, include: [{ model: MenuItem, attributes: ["id", "name", "price"] }] },
          ],
          order: [["createdAt", "DESC"]],
          limit: pageSize,
          offset: (page - 1) * pageSize,
        });
        return res.json({
          items: rows,
          total: count,
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize),
        });
      }

      // legacy (no pagination)
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

/* ----------------- vendor summary (keep before /vendor/:vendorId) ----------------- */
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

      const startOfToday = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
      const startOfWeek  = () => { const d = new Date(); const diff = (d.getDay()+6)%7; d.setHours(0,0,0,0); d.setDate(d.getDate()-diff); return d; };
      const startOfMonth = () => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(1); return d; };

      // exclude canceled & rejected from revenue
      const nonRevenueStatuses = ["rejected", "canceled"];
      const revenueWhere = { VendorId: vendorId, status: { [Op.notIn]: nonRevenueStatuses } };

      const [totalOrders, lifetimeRevenue] = await Promise.all([
        Order.count({ where: { VendorId: vendorId } }),
        Order.sum("totalAmount", { where: revenueWhere }),
      ]);

      const ST = ["pending", "accepted", "ready", "delivered", "rejected", "canceled"];
      const statusCounts = {};
      await Promise.all(
        ST.map(async (s) => {
          statusCounts[s] = await Order.count({ where: { VendorId: vendorId, status: s } });
        })
      );

      const todayStart = startOfToday();
      const weekStart  = startOfWeek();
      const monthStart = startOfMonth();

      const [ordersToday, revenueToday] = await Promise.all([
        Order.count({ where: { VendorId: vendorId, createdAt: { [Op.gte]: todayStart } } }),
        Order.sum("totalAmount", { where: { ...revenueWhere, createdAt: { [Op.gte]: todayStart } } }),
      ]);

      const [ordersWeek, revenueWeek] = await Promise.all([
        Order.count({ where: { VendorId: vendorId, createdAt: { [Op.gte]: weekStart } } }),
        Order.sum("totalAmount", { where: { ...revenueWhere, createdAt: { [Op.gte]: weekStart } } }),
      ]);

      const [ordersMonth, revenueMonth] = await Promise.all([
        Order.count({ where: { VendorId: vendorId, createdAt: { [Op.gte]: monthStart } } }),
        Order.sum("totalAmount", { where: { ...revenueWhere, createdAt: { [Op.gte]: monthStart } } }),
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

/* ----------------- vendor daily (for charts) ----------------- */
router.get(
  "/vendor/daily",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const vendorId = req.vendor.id;
      const days = Math.max(1, Math.min(90, Number(req.query.days) || 14));

      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (days - 1));

      const sequelizeLocal = Order.sequelize;
      // exclude canceled & rejected from revenue and order count
      const [rows] = await sequelizeLocal.query(
        `
        SELECT
          to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
          COUNT(*) FILTER (WHERE status NOT IN ('rejected','canceled'))                                     AS orders,
          COALESCE(SUM(CASE WHEN status NOT IN ('rejected','canceled') THEN "totalAmount" END), 0)           AS revenue
        FROM "orders"
        WHERE "VendorId" = :vendorId
          AND "createdAt" >= :startDate
        GROUP BY 1
        ORDER BY 1 ASC
        `,
        { replacements: { vendorId, startDate: start } }
      );

      const map = new Map(rows.map(r => [r.date, r]));
      const out = [];
      const d = new Date(start);
      for (let i = 0; i < days; i++) {
        const key = d.toISOString().slice(0, 10);
        out.push({
          date: key,
          orders: Number(map.get(key)?.orders || 0),
          revenue: Number(map.get(key)?.revenue || 0),
        });
        d.setDate(d.getDate() + 1);
      }

      res.json(out);
    } catch (err) {
      console.error("GET /api/orders/vendor/daily error:", err);
      res.status(500).json({ message: "Failed to build daily trend", error: err.message });
    }
  }
);

/* ----------------- vendor (any) orders by id (legacy) ----------------- */
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

// GET one order (user can see their own, vendor can see theirs, admin can see all)
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid order id" });

    const order = await Order.findByPk(id, {
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        { model: OrderItem, include: [{ model: MenuItem, attributes: ["id", "name", "price"] }] },
      ],
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const role = req.user?.role || "user";
    const isOwnerUser   = Number(order.UserId)   === Number(req.user.id);
    const vendorIdClaim = req.vendor?.id || req.user?.vendorId;
    const isOwnerVendor = vendorIdClaim && Number(order.VendorId) === Number(vendorIdClaim);
    const isAdmin       = role === "admin";

    if (!(isOwnerUser || isOwnerVendor || isAdmin)) {
      return res.status(403).json({ message: "Not authorized to view this order" });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: "Error fetching order", error: err.message });
  }
});

/* ----------------- create order (user) ----------------- */
router.post("/", authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { VendorId, vendorId, items, paymentMethod = "mock_online", note, address } = req.body;
    const idemKey = req.get("Idempotency-Key") || null;

    const vendorIdNum = Number(VendorId || vendorId);
    if (!Number.isFinite(vendorIdNum)) {
      await t.rollback();
      return res.status(400).json({ message: "VendorId must be a number", got: VendorId ?? vendorId });
    }
    if (!Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ message: "At least one item is required" });
    }

    // STEP 1: idempotency lookup (safe even if table missing)
    if (idemKey) {
      const existingKey = await safeFindIdempotencyKey(idemKey, req.user.id, t);
      if (existingKey?.orderId) {
        const existingOrder = await Order.findByPk(existingKey.orderId, {
          include: [
            { model: User, attributes: ["id", "name", "email"] },
            { model: Vendor, attributes: ["id", "name", "cuisine"] },
            { model: OrderItem, include: [{ model: MenuItem, attributes: ["id", "name", "price"] }] },
          ],
          transaction: t,
        });
        await t.commit();
        return res.status(200).json({ message: "Order already created", order: existingOrder });
      }
    }

    // Validate / normalize items
    const ids = [];
    const cleanItems = [];
    for (const it of items) {
      const mid = Number(it?.MenuItemId);
      const qty = Math.max(1, Number(it?.quantity || 0));
      if (!Number.isFinite(mid) || !Number.isFinite(qty)) {
        await t.rollback();
        return res.status(400).json({
          message: "Each item must include numeric MenuItemId and quantity (>0)",
          got: it,
        });
      }
      ids.push(mid);
      cleanItems.push({ MenuItemId: mid, quantity: qty });
    }

    // Load menu items to ensure all belong to this vendor + get prices
    const menuRows = await MenuItem.findAll({
      where: { id: ids, VendorId: vendorIdNum },
      attributes: ["id", "price", "name", "VendorId"],
      transaction: t,
    });

    const foundIds = menuRows.map((m) => Number(m.id));
    if (menuRows.length !== ids.length) {
      const missing = ids.filter((id) => !foundIds.includes(id));
      await t.rollback();
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

    // Create order
    const order = await Order.create(
      {
        UserId: req.user.id,
        VendorId: vendorIdNum,
        totalAmount: computedTotal,
        status: "pending",
        paymentMethod,
        paymentStatus: "unpaid",
        note: note || null,
        address: address || null,
      },
      { transaction: t }
    );

    // Create line items
    await OrderItem.bulkCreate(
      cleanItems.map((it) => ({
        OrderId: order.id,
        MenuItemId: it.MenuItemId,
        quantity: it.quantity,
      })),
      { transaction: t }
    );

    /* >>> AUTO-PAY FOR MOCK ONLINE <<< */
    if (paymentMethod === "mock_online") {
      order.paymentStatus = "paid";
      order.paidAt = new Date();
      await order.save({ transaction: t });
    }
    /* >>> END AUTO-PAY <<< */

    // STEP 2: store idempotency key (safe if table missing)
    if (idemKey) {
      await safeCreateIdempotencyKey({ key: idemKey, userId: req.user.id, orderId: order.id }, t);
    }

    // Reload full order (with includes)
    const fullOrder = await Order.findByPk(order.id, {
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        { model: OrderItem, include: [{ model: MenuItem, attributes: ["id", "name", "price"] }] },
      ],
      transaction: t,
    });

    await t.commit();

    // Live updates
    emitToVendorHelper(req, vendorIdNum, "order:new", fullOrder);
    emitToUserHelper(req, req.user.id, "order:new", fullOrder);

    /* >>> EMIT PAYMENT EVENT IF PAID <<< */
    if (fullOrder.paymentStatus === "paid") {
      const payPayload = { id: fullOrder.id, paymentStatus: fullOrder.paymentStatus, paidAt: fullOrder.paidAt };
      emitToVendorHelper(req, vendorIdNum, "order:payment", payPayload);
      emitToUserHelper(req, req.user.id, "order:payment", { ...payPayload, UserId: req.user.id });
      // push notify
      try {
        await notifyUser(req.user.id, {
          title: `Payment confirmed for Order #${fullOrder.id}`,
          body: "Thanks! Your payment is confirmed.",
          url: `/orders`,
          tag: `order-${fullOrder.id}`,
        });
      } catch (e) {
        console.warn("push notify failed:", e?.message);
      }
    }
    /* >>> END EMIT <<< */

    // Audit
    await audit(req, {
      action: "ORDER_CREATED",
      order: fullOrder,
      details: { items: cleanItems, totalAmount: computedTotal, paymentMethod },
    });

    return res.status(201).json({ message: "Order created", order: fullOrder });
  } catch (err) {
    try { await t.rollback(); } catch (_) {}
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

/* ----------------- user cancel (soft) ----------------- */
router.patch("/:id/cancel", authenticateToken, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!Number.isFinite(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const role = req.user?.role || "user";
    const isOwnerUser = Number(order.UserId) === Number(req.user.id);
    const isAdmin = role === "admin";
    if (!(isOwnerUser || isAdmin)) {
      return res.status(403).json({ message: "Not authorized to cancel this order" });
    }

    if (order.status !== "pending") {
      return res.status(400).json({ message: "Only pending orders can be canceled" });
    }
    if (order.paymentStatus === "paid") {
      return res.status(400).json({ message: "Paid orders cannot be canceled" });
    }

    order.status = "canceled";
    await order.save();

    // live updates
    emitToVendorHelper(req, order.VendorId, "order:status", { id: order.id, status: order.status });
    emitToUserHelper(req, order.UserId, "order:status", { id: order.id, status: order.status, UserId: order.UserId });

    // notify
    try {
      const title = `Order #${order.id} is canceled`;
      const body  = `You canceled this order.`;
      const url   = `/orders`;
      await notifyUser(order.UserId, { title, body, url, tag: `order-${order.id}` });
    } catch (e) {
      console.warn("push notify failed:", e?.message);
    }

    // Audit
    await audit(req, {
      action: "ORDER_CANCELED",
      order,
      details: { by: isOwnerUser ? "user" : "admin" },
    });

    return res.json({ message: "Order canceled", order });
  } catch (err) {
    return res.status(500).json({ message: "Failed to cancel order", error: err.message });
  }
});

/* ----------------- update (admin/legacy), delete, filter ----------------- */
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

// Vendor updates order status (accept / ready / delivered / rejected) — not "canceled"
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

      // live in-app updates via sockets
      emitToVendorHelper(req, order.VendorId, "order:status", { id: order.id, status: order.status });
      emitToUserHelper(req, order.UserId, "order:status", { id: order.id, status: order.status, UserId: order.UserId });

      // Optional push notification
      try {
        const title = `Order #${order.id} is ${order.status}`;
        const body  = `Vendor updated your order to "${order.status}".`;
        const url   = `/orders`;
        await notifyUser(order.UserId, { title, body, url, tag: `order-${order.id}` });
      } catch (e) {
        console.warn("push notify failed:", e?.message);
      }

      // Audit
      await audit(req, {
        action: "ORDER_STATUS_UPDATE",
        order,
        details: { by: "vendor", newStatus: status },
      });

      return res.json({ message: "Status updated", order });
    } catch (err) {
      return res.status(500).json({ message: "Failed to update status", error: err.message });
    }
  }
);

// (Optional) hard delete — consider restricting to admins only
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    await OrderItem.destroy({ where: { OrderId: order.id } });
    await order.destroy();

    // Audit
    await audit(req, {
      action: "ORDER_DELETED",
      order,
      details: { by: req.user?.role || "user" },
    });

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

/* ----------------- payment status ----------------- */
// Vendor/Admin marks payment status (e.g., COD delivered -> paid)
router.patch(
  "/:id/payment",
  authenticateToken,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body; // "paid" | "failed" | "unpaid"
      const role = req.user?.role || "user";

      const order = await Order.findByPk(id);
      if (!order) return res.status(404).json({ message: "Order not found" });

      // Only vendor who owns the order or admin can mark payments
      const vendorIdClaim = req.vendor?.id || req.user?.vendorId;
      const isOwnerVendor = vendorIdClaim && Number(order.VendorId) === Number(vendorIdClaim);
      const isAdmin = role === "admin";
      if (!(isOwnerVendor || isAdmin)) {
        return res.status(403).json({ message: "Not authorized to update payment for this order" });
      }

      const allowed = ["paid", "failed", "unpaid"];
      if (!allowed.includes(status)) {
        return res.status(400).json({ message: "Invalid payment status" });
      }

      // Do not allow payment updates on canceled/rejected
      if (["canceled", "rejected"].includes(order.status)) {
        return res.status(400).json({ message: `Cannot set payment on a ${order.status} order` });
      }

      // Update
      order.paymentStatus = status;
      order.paidAt = status === "paid" ? new Date() : null;
      await order.save();

      // live updates
      emitToVendorHelper(req, order.VendorId, "order:payment", { id: order.id, paymentStatus: order.paymentStatus, paidAt: order.paidAt });
      emitToUserHelper(req, order.UserId, "order:payment", { id: order.id, paymentStatus: order.paymentStatus, paidAt: order.paidAt, UserId: order.UserId });

      // push notify
      try {
        const title = `Payment ${status} for Order #${order.id}`;
        const body  = status === "paid" ? "Thanks! Your payment is confirmed." : (status === "failed" ? "Payment failed. Please try again." : "Payment set to unpaid.");
        const url   = `/orders`;
        await notifyUser(order.UserId, { title, body, url, tag: `order-${order.id}` });
      } catch (e) {
        console.warn("push notify failed:", e?.message);
      }

      // Audit
      await audit(req, {
        action: "ORDER_PAYMENT_UPDATE",
        order,
        details: { by: isOwnerVendor ? "vendor" : "admin", paymentStatus: status },
      });

      return res.json({ message: "Payment status updated", order });
    } catch (err) {
      return res.status(500).json({ message: "Failed to update payment", error: err.message });
    }
  }
);

/* ----------------- invoice helpers + routes ----------------- */
async function buildInvoiceHtml(order) {
  const escapeHtml = (s = "") =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const fmtINR = (n) => `₹${Number(n || 0).toFixed(2)}`;
  const LOGO = process.env.INVOICE_LOGO_URL || "";

  // Support both OrderItems include and MenuItems include
  const items = Array.isArray(order.MenuItems) && order.MenuItems.length
    ? order.MenuItems.map(mi => ({ name: mi.name, price: mi.price, qty: mi?.OrderItem?.quantity || 1 }))
    : Array.isArray(order.OrderItems) && order.OrderItems.length
    ? order.OrderItems.map(oi => ({ name: oi.MenuItem?.name || "Item", price: oi.MenuItem?.price, qty: oi.quantity || oi?.OrderItem?.quantity || 1 }))
    : [];

  const rowsHtml = items.map(it => `
    <tr>
      <td>${escapeHtml(it.name)}</td>
      <td class="right">${Number(it.qty || 1)}</td>
      <td class="right">${fmtINR(it.price || 0)}</td>
      <td class="right">${fmtINR((Number(it.price || 0) * Number(it.qty || 1)))}</td>
    </tr>`).join("");

  const computedSubTotal = items.reduce((sum, it) => sum + Number(it.price || 0) * Number(it.qty || 1), 0);
  const paymentMethod = order.paymentMethod === "mock_online" ? "Online (Mock)" : (order.paymentMethod || "COD");
  const paymentStatus = order.paymentStatus || "unpaid";
  const paidAt = order.paidAt ? new Date(order.paidAt).toLocaleString("en-IN") : "";
  const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleString("en-IN") : "-";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Invoice #${order.id}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root{ --ink:#111; --muted:#6b7280; --line:#e5e7eb; --brand:#111827; }
  *{ box-sizing: border-box; }
  body{ font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"; color: var(--ink); margin: 0; padding: 24px; background: #fff; }
  .wrap{ max-width: 860px; margin: 0 auto; }
  header{ display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
  .brand{ display:flex; align-items:center; gap:12px; }
  .brand img{ max-height: 48px; width: auto; }
  h1{ margin:0; font-size: 20px; }
  .muted{ color: var(--muted); }
  .grid{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0 24px; }
  .card{ border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
  table{ width: 100%; border-collapse: collapse; }
  thead th{ text-align: left; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); padding: 10px 8px; }
  tbody td{ padding: 10px 8px; border-bottom: 1px solid var(--line); }
  .right{ text-align: right; }
  .totals{ display: grid; grid-template-columns: 1fr 280px; gap: 16px; margin-top: 12px; align-items: start; }
  .totals .box{ border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
  .totals .row{ display:flex; justify-content: space-between; margin: 6px 0; }
  .grand{ font-weight: 700; font-size: 16px; }
  .badge{ display:inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; border:1px solid var(--line); }
  .paid{ background:#ecfdf5; border-color:#a7f3d0; }
  .unpaid{ background:#f9fafb; }
  .failed{ background:#fef2f2; border-color:#fecaca; }
  .actions{ margin: 18px 0 8px; }
  .btn{ background:#111827; color:#fff; border:0; padding:10px 14px; border-radius:8px; cursor:pointer; }
  @media print { .no-print, .actions { display: none !important; } body{ padding: 0; } @page { size: A4; margin: 14mm; } }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">
        ${LOGO ? `<img src="${escapeHtml(LOGO)}" alt="Logo" />` : ""}
        <div>
          <h1>Tax Invoice</h1>
          <div class="muted">Order #${order.id}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div><strong>${escapeHtml(order.Vendor?.name || "Vendor")}</strong></div>
        <div class="muted">${escapeHtml(order.Vendor?.cuisine || "")}</div>
        <div class="muted">Created: ${createdAt}</div>
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <div style="font-weight:600; margin-bottom:6px;">Billed To</div>
        <div>${escapeHtml(order.User?.name || "Customer")}</div>
        <div class="muted">${escapeHtml(order.User?.email || "")}</div>
      </div>
      <div class="card">
        <div style="font-weight:600; margin-bottom:6px;">Payment</div>
        <div>Method: ${escapeHtml(paymentMethod)}</div>
        <div>Status:
          <span class="badge ${paymentStatus === "paid" ? "paid" : (paymentStatus === "failed" ? "failed" : "unpaid")}">
            ${escapeHtml(paymentStatus)}
          </span>
        </div>
        ${paidAt ? `<div class="muted">Paid at: ${paidAt}</div>` : ""}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th class="right">Qty</th>
          <th class="right">Price</th>
          <th class="right">Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td class="muted" colspan="4" style="text-align:center">No line items</td></tr>`}
      </tbody>
    </table>

    <div class="totals">
      <div class="actions no-print">
        <button class="btn" onclick="window.print()">Print / Save PDF</button>
      </div>
      <div class="box">
        <div class="row"><span>Items total</span><span>${fmtINR(computedSubTotal)}</span></div>
        <div class="row grand"><span>Order total</span><span>${fmtINR(order.totalAmount)}</span></div>
        <div class="row"><span>Order status</span><span>${escapeHtml(order.status)}</span></div>
      </div>
    </div>

    <p class="muted" style="margin-top:16px; font-size:12px">
      This is a computer-generated invoice. For support, contact the vendor directly.
    </p>
  </div>
</body>
</html>`;
}

/* ----------------- HTML invoice (download/print from UI) ----------------- */
router.get("/:id/invoice", authenticateToken, async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: [
        { model: User,   attributes: ["name", "email"] },
        { model: Vendor, attributes: ["name", "cuisine"] },
        // include both shapes for safety
        { model: MenuItem, attributes: ["name", "price"], through: { attributes: ["quantity"] } },
        { model: OrderItem, include: [{ model: MenuItem, attributes: ["name", "price"] }] },
      ],
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const html = await buildInvoiceHtml(order);
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    return res.status(500).json({ message: "Error generating invoice", error: err.message });
  }
});

/* ----------------- PDF invoice (optional puppeteer) ----------------- */
router.get("/:id/invoice.pdf", authenticateToken, async (req, res) => {
  if (!Puppeteer) {
    return res.status(501).json({ message: "PDF generation not enabled. Install 'puppeteer'." });
  }
  try {
    const order = await Order.findByPk(req.params.id, {
      include: [
        { model: User,   attributes: ["name", "email"] },
        { model: Vendor, attributes: ["name", "cuisine"] },
        { model: MenuItem, attributes: ["name", "price"], through: { attributes: ["quantity"] } },
        { model: OrderItem, include: [{ model: MenuItem, attributes: ["name", "price"] }] },
      ],
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const html = await buildInvoiceHtml(order);

    const browser = await Puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" },
    });
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="invoice-${order.id}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    return res.status(500).json({ message: "Error generating PDF", error: err.message });
  }
});

/* ----------------- VENDOR PAYOUTS SUMMARY ----------------- */
router.get(
  "/payouts/summary",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const vendorId = req.vendor.id;
      const { from, to } = req.query;
      const where = {
        VendorId: vendorId,
        status: { [Op.notIn]: ["rejected", "canceled"] },
      };
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt[Op.gte] = new Date(from);
        if (to)   where.createdAt[Op.lte] = new Date(to);
      }

      const grossPaid = await Order.sum("totalAmount", { where: { ...where, paymentStatus: "paid" } }) || 0;
      const paidOrders = await Order.count({ where: { ...where, paymentStatus: "paid" } });
      const unpaidGross = await Order.sum("totalAmount", { where: { ...where, paymentStatus: { [Op.ne]: "paid" } } }) || 0;

      const commission = +(grossPaid * COMMISSION_PCT).toFixed(2);
      const netOwed    = +(grossPaid - commission).toFixed(2);

      return res.json({
        vendorId,
        dateRange: { from: from || null, to: to || null },
        rate: COMMISSION_PCT,
        paidOrders,
        grossPaid: +grossPaid.toFixed(2),
        commission,
        netOwed,
        grossUnpaid: +unpaidGross.toFixed(2),
      });
    } catch (err) {
      return res.status(500).json({ message: "Failed to build payouts summary", error: err.message });
    }
  }
);

/* ----------------- ADMIN: all vendor summaries ----------------- */
router.get("/payouts/summary/all", authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin only" });
    const { from, to } = req.query;
    const where = {
      status: { [Op.notIn]: ["rejected", "canceled"] },
      paymentStatus: "paid",
    };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt[Op.gte] = new Date(from);
      if (to)   where.createdAt[Op.lte] = new Date(to);
    }

    const rows = await Order.findAll({
      attributes: [
        "VendorId",
        [sequelize.fn("COUNT", sequelize.col("Order.id")), "paidOrders"],
        [sequelize.fn("SUM", sequelize.col("totalAmount")), "grossPaid"],
      ],
      where,
      include: [{ model: Vendor, attributes: ["id", "name"] }],
      group: ["VendorId", "Vendor.id"],
      order: [[sequelize.fn("SUM", sequelize.col("totalAmount")), "DESC"]],
    });

    const out = rows.map(r => {
      const grossPaid = Number(r.get("grossPaid") || 0);
      const paidOrders = Number(r.get("paidOrders") || 0);
      const commission = +(grossPaid * COMMISSION_PCT).toFixed(2);
      const netOwed = +(grossPaid - commission).toFixed(2);
      return {
        vendorId: r.VendorId,
        vendorName: r.Vendor?.name || "-",
        paidOrders,
        grossPaid: +grossPaid.toFixed(2),
        commission,
        netOwed,
        rate: COMMISSION_PCT,
      };
    });

    return res.json(out);
  } catch (err) {
    return res.status(500).json({ message: "Failed to build admin payouts", error: err.message });
  }
});

/* ----------------- ADMIN: orders list with commission ----------------- */
router.get("/admin", authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin only" });

    const { page = 1, pageSize = 20, status, paymentStatus, vendorId, userId } = req.query;
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));

    const where = {};
    if (status)        where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (vendorId)      where.VendorId = Number(vendorId);
    if (userId)        where.UserId = Number(userId);

    const { count, rows } = await Order.findAndCountAll({
      where,
      include: [
        { model: Vendor, attributes: ["id", "name"] },
        { model: User,   attributes: ["id", "name", "email"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: ps,
      offset: (p - 1) * ps,
    });

    const items = rows.map(o => ({
      ...o.toJSON(),
      commissionAmount: +(Number(o.totalAmount || 0) * COMMISSION_PCT).toFixed(2),
      commissionRate: COMMISSION_PCT,
    }));

    return res.json({
      items,
      total: count,
      page: p,
      pageSize: ps,
      totalPages: Math.ceil(count / ps),
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch admin orders", error: err.message });
  }
});

module.exports = router;