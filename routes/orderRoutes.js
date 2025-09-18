
// routes/orderRoutes.js
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
  Payout, // ✅ used in /:id/status
} = require("../models");

const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");
const sequelize = Order.sequelize;
const { notifyUser } = require("../utils/notifications");

/* ---------- config / optional deps ---------- */
const COMMISSION_PCT = Number(process.env.COMMISSION_PCT || 0.15);
let Puppeteer = null;
try { Puppeteer = require("puppeteer"); } catch {}

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
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

async function safeCreateIdempotencyKey(record, t) {
  if (!IdempotencyKey || typeof IdempotencyKey.create !== "function") return;
  try {
    await IdempotencyKey.create(record, { transaction: t });
  } catch (err) {
    if (isMissingTableError(err)) return;
    throw err;
  }
}

/* ----------------- unified filter handler ----------------- */
async function filterHandler(req, res) {
  const src = req.method === "GET" ? req.query : req.body;
  const { UserId, VendorId, status, startDate, endDate } = src;

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
        { model: Vendor, attributes: ["id", "name", "cuisine", "commissionRate"] },
        { model: MenuItem, attributes: ["id", "name", "price"], through: { attributes: ["quantity"] } },
      ],
      order: [["createdAt", "DESC"]],
    });
    return res.json({ items: orders });
  } catch (err) {
    return res.status(500).json({ message: "Error filtering orders", error: err.message });
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

    // ✅ Non-paginated returns consistent object
    const rows = await Order.findAll({
      where: { UserId: req.user.id },
      include: [
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        { model: MenuItem, attributes: ["id", "name", "price"], through: { attributes: ["quantity"] } },
      ],
      order: [["createdAt", "DESC"]],
    });
    return res.json({
      items: rows,
      total: rows.length,
      page: 0,
      pageSize: rows.length,
      totalPages: 1,
    });
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

      // ✅ Non-paginated returns consistent object
      const rows = await Order.findAll({
        where: { VendorId: vendorId },
        include: [
          { model: User, attributes: ["id", "name", "email"] },
          { model: OrderItem, include: [{ model: MenuItem, attributes: ["id", "name", "price"] }] },
        ],
        order: [["createdAt", "DESC"]],
      });
      return res.json({
        items: rows,
        total: rows.length,
        page: 0,
        pageSize: rows.length,
        totalPages: 1,
      });
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

      // ✅ use actual table name from Sequelize (handles "Orders" vs "orders")
      const tname = Order.getTableName();
      const table =
        typeof tname === "object" && tname.schema ? `"${tname.schema}"."${tname.tableName}"` :
        typeof tname === "string" ? `"${tname}"` : `"Orders"`;

      const [rows] = await sequelize.query(
        `
        SELECT
          to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
          COUNT(*) FILTER (WHERE status NOT IN ('rejected','canceled')) AS orders,
          COALESCE(SUM(CASE WHEN status NOT IN ('rejected','canceled') THEN "totalAmount" END), 0) AS revenue
        FROM ${table}
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

/* ----------------- GET one order ----------------- */
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

    // STEP 1: idempotency lookup
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
        return res.status(200).json(existingOrder);
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

    // Reload full order
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

    return res.status(201).json(fullOrder);
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

    if ((order.status || "").toLowerCase() !== "pending") {
      return res.status(400).json({ message: "Only pending orders can be canceled" });
    }
    if ((order.paymentStatus || "").toLowerCase() === "paid") {
      return res.status(400).json({ message: "Paid orders cannot be canceled" });
    }

    order.status = "canceled";
    await order.save();

    emitToVendorHelper(req, order.VendorId, "order:status", { id: order.id, status: order.status });
    emitToUserHelper(req, order.UserId, "order:status", { id: order.id, status: order.status, UserId: order.UserId });

    try {
      const title = `Order #${order.id} is canceled`;
      const body  = `You canceled this order.`;
      const url   = `/orders`;
      await notifyUser(order.UserId, { title, body, url, tag: `order-${order.id}` });
    } catch (e) {
      console.warn("push notify failed:", e?.message);
    }

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

/* ----------------- vendor updates order status ----------------- */
router.patch(
  "/:id/status",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const vendorId = req.vendor.id;
      const { id } = req.params;
      const statusRaw = String(req.body?.status || "").toLowerCase();

      const allowed = ["pending", "accepted", "rejected", "ready", "delivered"];
      if (!allowed.includes(statusRaw)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const order = await Order.findByPk(id, { include: [{ model: Vendor }] });
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.VendorId !== vendorId) {
        return res.status(403).json({ message: "Not your order" });
      }

      order.status = statusRaw;
      await order.save();

      // live updates
      emitToVendorHelper(req, order.VendorId, "order:status", { id: order.id, status: order.status });
      emitToUserHelper(req, order.UserId, "order:status", { id: order.id, status: order.status, UserId: order.UserId });

      // push notification
      try {
        const title = `Order #${order.id} is ${order.status}`;
        const body  = `Vendor updated your order to "${order.status}".`;
        const url   = `/orders`;
        await notifyUser(order.UserId, { title, body, url, tag: `order-${order.id}` });
      } catch (e) {
        console.warn("push notify failed:", e?.message);
      }

      // audit log
      await audit(req, {
        action: "ORDER_STATUS_UPDATE",
        order,
        details: { by: "vendor", newStatus: statusRaw },
      });

      // ✅ payout creation on delivered + paid
      if (statusRaw === "delivered" && order.paymentStatus === "paid") {
        const gross = Number(order.totalAmount || 0);

        const rate =
          (order.commissionRate != null ? Number(order.commissionRate) : null) ??
          (order.Vendor?.commissionRate != null ? Number(order.Vendor.commissionRate) : null) ??
          Number(process.env.PLATFORM_RATE || 0.15);

        const commission = Math.max(0, gross * (isFinite(rate) ? rate : 0.15));
        const payout = Math.max(0, gross - commission);

        await Payout.upsert({
          orderId: order.id,
          VendorId: order.VendorId,
          grossAmount: gross,
          commissionAmount: commission,
          payoutAmount: payout,
          status: "pending",
        });

        // live payout update
        req.app.get("emitToVendor")?.(order.VendorId, "payout:update", {
          orderId: order.id,
          VendorId: order.VendorId,
          payoutAmount: payout,
          status: "pending",
        });
      }

      return res.json({ message: "Status updated", order });
    } catch (err) {
      console.error("order status error:", err);
      return res.status(500).json({ message: "Failed to update status", error: err.message });
    }
  }
);

/* ----------------- hard delete (restrict as needed) ----------------- */
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    await OrderItem.destroy({ where: { OrderId: order.id } });
    await order.destroy();

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

/* ----------------- filter routes ----------------- */
router.get("/filter", authenticateToken, filterHandler);
router.post("/filter", authenticateToken, filterHandler);

/* ----------------- payment status ----------------- */
router.patch("/:id/payment", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const raw = (req.body?.paymentStatus ?? req.body?.status ?? "").toString().toLowerCase();
    const status = raw || "unpaid";

    const allowed = ["paid", "failed", "unpaid"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid payment status" });
    }

    const order = await Order.findByPk(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const role = req.user?.role || "user";
    let vendorIdClaim = req.vendor?.id || req.user?.vendorId || null;
    if (!vendorIdClaim && role === "vendor") {
      try {
        const v = await Vendor.findOne({ where: { UserId: req.user.id }, attributes: ["id"] });
        if (v) vendorIdClaim = v.id;
      } catch (_) {}
    }
    const isOwnerVendor =
      vendorIdClaim && Number(order.VendorId) === Number(vendorIdClaim);
    const isAdmin = role === "admin";

    if (!(isOwnerVendor || isAdmin)) {
      return res
        .status(403)
        .json({ message: "Not authorized to update payment for this order" });
    }

    if (["canceled", "cancelled", "rejected"].includes((order.status || "").toLowerCase())) {
      return res
        .status(400)
        .json({ message: `Cannot set payment on a ${order.status} order` });
    }

    order.paymentStatus = status;
    order.paidAt = status === "paid" ? new Date() : null;
    await order.save();

    emitToVendorHelper(req, order.VendorId, "order:payment", {
      id: order.id,
      paymentStatus: order.paymentStatus,
      paidAt: order.paidAt,
    });
    emitToUserHelper(req, order.UserId, "order:payment", {
      id: order.id,
      paymentStatus: order.paymentStatus,
      paidAt: order.paidAt,
      UserId: order.UserId,
    });

    try {
      const title = `Payment ${status} for Order #${order.id}`;
      const body =
        status === "paid"
          ? "Thanks! Your payment is confirmed."
          : status === "failed"
          ? "Payment failed. Please try again."
          : "Payment set to unpaid.";
      const url = `/orders`;
      await notifyUser(order.UserId, { title, body, url, tag: `order-${order.id}` });
    } catch (e) {
      console.warn("push notify failed:", e?.message);
    }

    await audit(req, {
      action: "ORDER_PAYMENT_UPDATE",
      order,
      details: { by: isOwnerVendor ? "vendor" : "admin", paymentStatus: status },
    });

    return res.json({ message: "Payment status updated", order });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update payment", error: err.message });
  }
});

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
<html lang="en"> ... (unchanged HTML) ... </html>`;
}

/* ----------------- HTML invoice ----------------- */
router.get("/:id/invoice", authenticateToken, async (req, res) => {
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
    const p  = Math.max(1, Number(page) || 1);
    const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));

    const where = {};
    if (status)        where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (vendorId)      where.VendorId = Number(vendorId);
    if (userId)        where.UserId = Number(userId);

    const { count, rows } = await Order.findAndCountAll({
      where,
      include: [
        { model: Vendor, attributes: ["id", "name", "commissionRate"] },
        { model: User,   attributes: ["id", "name", "email"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: ps,
      offset: (p - 1) * ps,
    });

    const items = rows.map((o) => {
      const rate = (o.Vendor && o.Vendor.commissionRate != null)
        ? Number(o.Vendor.commissionRate)
        : Number(process.env.COMMISSION_PCT || 0.15);
      const gross = Number(o.totalAmount || 0);
      const commissionAmount = +(gross * rate).toFixed(2);
      return {
        ...o.toJSON(),
        commissionAmount,
        commissionRate: rate,
      };
    });

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