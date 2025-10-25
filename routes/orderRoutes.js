// routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const { Op, fn, col } = require("sequelize");

const {
  IdempotencyKey,
  Order,
  OrderItem,
  Vendor,
  MenuItem,
  User,
  Payout, // optional
} = require("../models");

const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");
const sequelize = Order.sequelize;
const { notifyUser } = require("../utils/notifications");

// ---- OPTIONAL puppeteer (for PDF invoices). Safe if not installed.
let Puppeteer = null;
try { Puppeteer = require("puppeteer"); } catch (_) { /* optional */ }

// ---- Date helper (single source of truth)
function parseDate(input) {
  if (!input) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ===================== PAYOUTS SUMMARY HELPERS =====================
const COMMISSION_PCT = Number(process.env.COMMISSION_PCT || 0.15);

async function safeSum(model, field, where) {
  try {
    const n = await model.sum(field, { where });
    return Number(n || 0);
  } catch (err) {
    console.error("safeSum error:", err.message);
    return 0;
  }
}
async function safeCount(model, where) {
  try {
    const n = await model.count({ where });
    return Number(n || 0);
  } catch (err) {
    console.error("safeCount error:", err.message);
    return 0;
  }
}

/* ---------- socket helpers ---------- */
function emitToVendorHelper(req, vendorId, event, payload) {
  const fn = req.emitToVendor || req.app.get("emitToVendor");
  if (typeof fn === "function") fn(vendorId, event, payload);
}
function emitToUserHelper(req, userId, event, payload) {
  const fn = req.emitToUser || req.app.get("emitToUser");
  if (typeof fn === "function") fn(userId, event, payload);
}

/* ---------- audit (safe) ---------- */
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

/* ---------- helpers ---------- */
function parsePageParams(q) {
  const pageRaw = Number(q.page);
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const pageSizeRaw = Number(q.pageSize);
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(100, Math.max(1, pageSizeRaw)) : 20;
  return { page, pageSize };
}

/** Find vendor for a user; create a minimal one if missing. */
async function getOrCreateVendorForUser(userId) {
  if (!userId) return null;
  let v = await Vendor.findOne({ where: { UserId: userId } });
  if (!v) {
    v = await Vendor.create({
      UserId: userId,
      name: `Vendor ${userId}`,
      location: "TBD",
      cuisine: null,
      phone: null,
      isOpen: true,
      isDeleted: false,
    });
  }
  if (v.isDeleted) { v.isDeleted = false; await v.save(); }
  return v;
}

// collect ALL VendorIds for this user (covers historical vendor rows)
async function buildVendorScope(req) {
  const vendors = await Vendor.findAll({
    where: { UserId: req.user.id },
    attributes: ["id"],
  });
  const ids = vendors.map(v => Number(v.id)).filter(Number.isFinite);
  if (req.vendor?.id && !ids.includes(Number(req.vendor.id))) ids.push(Number(req.vendor.id));
  return ids.length ? ids : [-1];
}

// Robust vendorId resolver
async function resolveVendorId(req) {
  if (req.query?.vendorId && Number.isFinite(Number(req.query.vendorId))) return Number(req.query.vendorId);
  const candidates = [
    req.user?.VendorId,
    req.user?.vendorId,
    req.user?.vendor?.id,
    req.vendor?.id,
  ].map(n => Number(n)).filter(n => Number.isFinite(n));
  if (candidates.length) return candidates[0];
  try {
    if (req.user?.id) {
      const v = await Vendor.findOne({ where: { UserId: req.user.id }, attributes: ["id"] });
      if (v?.id) return Number(v.id);
    }
  } catch {}
  return null;
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

/* ===================== USER: MY ORDERS ===================== */
// GET /orders/my  — user’s orders with refund info added
router.get("/my", authenticateToken, async (req, res) => {
  try {
    const { page, pageSize } = parsePageParams(req.query);

    const baseInclude = [
      { model: Vendor, attributes: ["id", "name", "cuisine"] },
      {
        model: MenuItem,
        attributes: ["id", "name", "price"],
        through: { attributes: ["quantity"] },
      },
    ];

    // Helper: normalize/augment an order with a refundable summary
    const serializeOrder = (o) => {
      const j = typeof o?.toJSON === "function" ? o.toJSON() : o || {};

      const status = String(j.status || "").toLowerCase();
      const paymentStatus = String(j.paymentStatus || "").toLowerCase();

      // If your schema has these columns, we surface them; otherwise fall back
      const refundStatusExplicit = j.refundStatus ?? null;
      const refundAmountExplicit = j.refundAmount ?? null;
      const refundedAtExplicit = j.refundedAt ?? null;

      // Derived refund status:
      // - If explicitly present, use it
      // - Else if paid AND user-cancelled/rejected, mark as pending
      const refundStatus =
        refundStatusExplicit ??
        (paymentStatus === "paid" &&
        (status === "cancelled" || status === "rejected")
          ? "pending"
          : null);

      // Prefer explicit refund amount; otherwise leave 0 (UI can still show paid total)
      const paidTotal = Number(
        j.totalAmount ?? j.subtotal ?? j.total ?? 0
      );
      const refundAmount = Number(refundAmountExplicit ?? 0);

      return {
        ...j,
        // Add a friendly nested block UIs can rely on
        refund: {
          status: refundStatus,        // "pending" | "approved" | "failed" | null
          amount: refundAmount,        // numeric, 0 if not set
          paidTotal,                   // how much was originally paid
          refundedAt: refundedAtExplicit, // timestamp or null
        },
      };
    };

    if (page > 1) {
      const { count, rows } = await Order.findAndCountAll({
        where: { UserId: req.user.id },
        include: baseInclude,
        order: [["createdAt", "DESC"]],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });

      const items = rows.map(serializeOrder);

      return res.json({
        items,
        total: count,
        page,
        pageSize,
        totalPages: Math.ceil(count / pageSize),
      });
    }

    const rows = await Order.findAll({
      where: { UserId: req.user.id },
      include: baseInclude,
      order: [["createdAt", "DESC"]],
    });

    const items = rows.map(serializeOrder);

    return res.json({
      items,
      total: items.length,
      page: 1,
      pageSize: items.length,
      totalPages: 1,
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching user orders", error: err.message });
  }
});

//Add this alias (keep compatibility)
router.get("/user", authenticateToken, async (req, res) => {
  req.url = "/my"; //redirect internally
  return router.handle(req, res);
});

// ---------------------------------------------------------------
// GET /api/orders/vendor/summary
// ---------------------------------------------------------------
router.get(
  "/vendor/summary",
  authenticateToken,
  requireVendor,
  async (req, res) => {
    try {
      const v = await getOrCreateVendorForUser(req.user.id);
      if (!v) return res.status(404).json({ message: "Vendor profile not found" });

      const vendorId = v.id;

      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const sevenDaysAgo  = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const startOfMonth  = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

      const sum   = (field, where) => Order.sum(field, { where }).then(n => Number(n || 0));
      const count = (where)         => Order.count({ where });

      const [
        todayOrders,  todayRevenue,
        weekOrders,   weekRevenue,
        monthOrders,  monthRevenue,
        totalOrders,  totalRevenue,
        pendingCnt,   acceptedCnt, readyCnt, deliveredCnt, rejectedCnt, unknownCnt,
      ] = await Promise.all([
        count({ VendorId: vendorId, createdAt: { [Op.gte]: startOfToday } }),
        sum("totalAmount", { VendorId: vendorId, createdAt: { [Op.gte]: startOfToday } }),

        count({ VendorId: vendorId, createdAt: { [Op.gte]: sevenDaysAgo } }),
        sum("totalAmount", { VendorId: vendorId, createdAt: { [Op.gte]: sevenDaysAgo } }),

        count({ VendorId: vendorId, createdAt: { [Op.gte]: startOfMonth } }),
        sum("totalAmount", { VendorId: vendorId, createdAt: { [Op.gte]: startOfMonth } }),

        count({ VendorId: vendorId }),
        sum("totalAmount", { VendorId: vendorId }),

        count({ VendorId: vendorId, status: "pending"   }),
        count({ VendorId: vendorId, status: "accepted"  }),
        count({ VendorId: vendorId, status: "ready"     }),
        count({ VendorId: vendorId, status: "delivered" }),
        count({ VendorId: vendorId, status: "rejected"  }),
        count({ VendorId: vendorId, status: null        }),
      ]);

      const byStatus = {
        pending:   pendingCnt,
        accepted:  acceptedCnt,
        ready:     readyCnt,
        delivered: deliveredCnt,
        rejected:  rejectedCnt,
        unknown:   unknownCnt,
      };

      return res.json({
        today:  { orders: todayOrders,  revenue: todayRevenue  },
        week:   { orders: weekOrders,   revenue: weekRevenue   },
        month:  { orders: monthOrders,  revenue: monthRevenue  },
        totals: { orders: totalOrders,  revenue: totalRevenue  },
        byStatus,
      });
    } catch (e) {
      console.error("vendor summary error:", e?.message || e);
      return res.status(500).json({ message: "Failed to build summary" });
    }
  }
);

/* ---------------------------------------------------------------
   GET /api/orders/vendor/daily?days=14
-----------------------------------------------------------------*/
router.get(
  "/vendor/daily",
  authenticateToken,
  requireVendor,
  async (req, res) => {
    try {
      const v = await getOrCreateVendorForUser(req.user.id);
      if (!v) return res.status(404).json({ message: "Vendor profile not found" });
      const vendorId = v.id;

      const days = Math.max(1, Math.min(90, Number(req.query.days) || 14));
      const since = new Date();
      since.setDate(since.getDate() - days);
      since.setHours(0,0,0,0);

      const rows = await Order.findAll({
        where: { VendorId: vendorId, createdAt: { [Op.gte]: since } },
        attributes: ["id", "totalAmount", "createdAt"],
        order: [["createdAt", "ASC"]],
        raw: true,
      });

      const map = new Map();
      for (const r of rows) {
        const d = new Date(r.createdAt);
        const key = d.toISOString().slice(0, 10);
        const cur = map.get(key) || { date: key, orders: 0, revenue: 0 };
        cur.orders += 1;
        cur.revenue += Number(r.totalAmount || 0);
        map.set(key, cur);
      }

      const out = [];
      const cursor = new Date(since);
      for (let i = 0; i < days; i++) {
        const key = cursor.toISOString().slice(0, 10);
        out.push(map.get(key) || { date: key, orders: 0, revenue: 0 });
        cursor.setDate(cursor.getDate() + 1);
      }

      res.json(out);
    } catch (e) {
      console.error("daily error:", e);
      res.status(500).json({ message: "Failed to build daily trend" });
    }
  }
);

/* ---------------------------------------------------------------
   GET /api/orders/vendor?page=1&pageSize=200
-----------------------------------------------------------------*/
router.get(
  "/vendor",
  authenticateToken,
  requireVendor,
  async (req, res) => {
    try {
      const v = await getOrCreateVendorForUser(req.user.id);
      if (!v) return res.status(404).json({ message: "Vendor profile not found" });

      const vendorId = v.id;
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.max(1, Math.min(500, Number(req.query.pageSize) || 50));

      const orders = await Order.findAll({
        where: { VendorId: vendorId },
        include: [{
          model: OrderItem,
          include: [{ model: MenuItem }],
        }],
        order: [["createdAt", "DESC"]],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });

      res.json(orders);
    } catch (e) {
      console.error("orders list error:", e);
      res.status(500).json({ message: "Failed to fetch vendor orders" });
    }
  }
);

/* ===================== VENDOR ORDERS (legacy by param) ===================== */
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


/* ===================== CREATE ORDER ===================== */
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

    await OrderItem.bulkCreate(
      cleanItems.map((it) => ({
        OrderId: order.id,
        MenuItemId: it.MenuItemId,
        quantity: it.quantity,
      })),
      { transaction: t }
    );

    if (paymentMethod === "mock_online") {
      order.paymentStatus = "paid";
      order.paidAt = new Date();
      await order.save({ transaction: t });
    }

    if (idemKey) {
      await safeCreateIdempotencyKey({ key: idemKey, userId: req.user.id, orderId: order.id }, t);
    }

    const fullOrder = await Order.findByPk(order.id, {
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        { model: OrderItem, include: [{ model: MenuItem, attributes: ["id", "name", "price"] }] },
      ],
      transaction: t,
    });

    await t.commit();

    emitToVendorHelper(req, vendorIdNum, "order:new", fullOrder);
    emitToUserHelper(req, req.user.id, "order:new", fullOrder);

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

    await audit(req, {
      action: "ORDER_CREATED",
      order: fullOrder,
      details: { items: cleanItems, totalAmount: computedTotal, paymentMethod },
    });

    return res.status(201).json(fullOrder);
  } catch (err) {
    try { await t.rollback(); } catch {}
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

/* ===================== USER CANCEL ===================== */
router.patch("/:id/cancel", authenticateToken, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!Number.isFinite(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // --- auth: owner or admin can cancel ---
    const role = String(req.user?.role || "user").toLowerCase();
    const isOwnerUser = Number(order.UserId) === Number(req.user.id);
    const isAdmin = role === "admin";
    if (!(isOwnerUser || isAdmin)) {
      return res.status(403).json({ message: "Not authorized to cancel this order" });
    }

    // --- guards: only pending/accepted can be canceled ---
    const status = String(order.status || "").toLowerCase();
    const terminal = ["ready", "delivered", "rejected", "cancelled"];
    if (!["pending", "accepted"].includes(status)) {
      return res
        .status(400)
        .json({ message: "Only pending/accepted orders can be canceled" });
    }

    // --- set cancelled + timestamp ---
    order.status = "cancelled";
    order.cancelledAt = new Date();

    // --- refund flow (optional): if already paid, mark refundStatus & set paymentStatus -> refunded ---
    const pay = String(order.paymentStatus || "").toLowerCase();
    if (pay === "paid") {
      order.refundStatus = "pending";
      await order.save(); // persist pending state before async step

      try {
        // TODO: replace with real gateway refund
        await new Promise((r) => setTimeout(r, 1200));
        order.refundStatus = "success";
        order.paymentStatus = "refunded";
      } catch {
        order.refundStatus = "failed";
      }
    }

    await order.save();

    // --- live updates to vendor & user ---
    emitToVendorHelper(req, order.VendorId, "order:status", {
      id: order.id,
      status: order.status,
    });
    emitToUserHelper(req, order.UserId, "order:status", {
      id: order.id,
      status: order.status,
      UserId: order.UserId,
    });

    // --- push notify (best-effort) ---
    try {
      const title = `Order #${order.id} was cancelled`;
      const body = pay === "paid"
        ? `Order cancelled. Refund status: ${order.refundStatus || "none"}.`
        : `You cancelled this order.`;
      const url = `/orders/${order.id}`;
      await notifyUser(order.UserId, { title, body, url, tag: `order-${order.id}` });
    } catch (e) {
      console.warn("push notify failed:", e?.message);
    }

    // --- audit log ---
    await audit(req, {
      action: "ORDER_CANCELED",
      order,
      details: { by: isOwnerUser ? "user" : "admin" },
    });

    return res.json({ ok: true, message: "Order cancelled", order });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to cancel order", error: err?.message });
  }
});


// CANCEL ORDER
router.patch("/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // allow only if pending/accepted
    if (!["pending", "accepted"].includes(order.status)) {
      return res.status(400).json({ message: "Order cannot be cancelled now" });
    }

    order.status = "rejected";
    await order.save();
    res.json(order);
  } catch (err) {
    console.error("Cancel order error:", err);
    res.status(500).json({ message: "Failed to cancel order" });
  }
});

// REORDER (create new order with same items)
router.post("/:id/reorder", authMiddleware, async (req, res) => {
  try {
    const prevOrder = await Order.findByPk(req.params.id, {
      include: [{ model: OrderItem, include: [MenuItem] }],
    });
    if (!prevOrder)
      return res.status(404).json({ message: "Previous order not found" });

    const newOrder = await Order.create({
      UserId: req.user.id,
      VendorId: prevOrder.VendorId,
      status: "pending",
      totalAmount: prevOrder.totalAmount,
      paymentMethod: "cod",
      paymentStatus: "unpaid",
    });

    // clone items
    const newItems = prevOrder.OrderItems.map((oi) => ({
      OrderId: newOrder.id,
      MenuItemId: oi.MenuItemId,
      quantity: oi.quantity,
      price: oi.price,
    }));
    await OrderItem.bulkCreate(newItems);

    res.json({
      message: "Order recreated successfully",
      newOrderId: newOrder.id,
    });
  } catch (err) {
    console.error("Reorder error:", err);
    res.status(500).json({ message: "Failed to reorder" });
  }
});


/* ===================== UPDATE (legacy/admin) ===================== */
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

// ===================== UPDATE STATUS (admin OR owning vendor) =====================
router.patch("/:id/status", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const statusRaw = String(req.body?.status || "").toLowerCase();

    const allowed = ["pending", "accepted", "rejected", "ready", "delivered"];
    if (!allowed.includes(statusRaw)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const order = await Order.findByPk(id, { include: [{ model: Vendor }] });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const role = String(req.user?.role || "").toLowerCase();

    let isOwnerVendor = false;
    if (role === "vendor") {
      try {
        const vendorIds = await Vendor.findAll({
          where: { UserId: req.user.id },
          attributes: ["id"],
          raw: true,
        }).then((rows) => rows.map((r) => Number(r.id)));

        isOwnerVendor = vendorIds.includes(Number(order.VendorId));
      } catch {}
    }

    const isAdmin = role === "admin";
    if (!(isAdmin || isOwnerVendor)) {
      return res.status(403).json({ message: "Not authorized to update this order" });
    }

    order.status = statusRaw;
    await order.save();

    emitToVendorHelper(req, order.VendorId, "order:status", { id: order.id, status: order.status });
    emitToUserHelper(req, order.UserId, "order:status", { id: order.id, status: order.status, UserId: order.UserId });

    try {
      const title = `Order #${order.id} is ${order.status}`;
      const body = isAdmin ? "Admin updated your order." : "Vendor updated your order.";
      await notifyUser(order.UserId, { title, body, url: `/orders`, tag: `order-${order.id}` });
    } catch (e) {
      console.warn("push notify failed:", e?.message);
    }

    // materialize payout when delivered & paid
    if (statusRaw === "delivered" && order.paymentStatus === "paid" && Payout?.upsert) {
      const gross = Number(order.totalAmount || 0);
      const rate =
        (order.commissionRate != null ? Number(order.commissionRate) : null) ??
        (order.Vendor?.commissionRate != null ? Number(order.Vendor.commissionRate) : null) ??
        Number(process.env.PLATFORM_RATE || 0.15);

      const commission = Math.max(0, gross * (Number.isFinite(rate) ? rate : 0.15));
      const payout = Math.max(0, gross - commission);

      await Payout.upsert({
        OrderId: order.id,
        VendorId: order.VendorId,
        grossAmount: gross,
        commissionAmount: commission,
        payoutAmount: payout,
        status: "pending",
      });

      req.app.get("emitToVendor")?.(order.VendorId, "payout:update", {
        orderId: order.id,
        VendorId: order.VendorId,
        payoutAmount: payout,
        status: "pending",
      });
    }

    await audit(req, {
      action: "ORDER_STATUS_UPDATE",
      order,
      details: { by: isAdmin ? "admin" : "vendor", status: statusRaw },
    });

    return res.json({ message: "Status updated", order });
  } catch (err) {
    console.error("order status error:", err);
    return res.status(500).json({ message: "Failed to update status", error: err.message });
  }
});

/* ===================== HARD DELETE ===================== */
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    if (String(req.user?.role).toLowerCase() !== "admin") {
      return res.status(403).json({ message: "Only admin can delete orders" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

    const order = await Order.findByPk(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Soft delete flag; add this column in your model/migration if you don't have it yet.
    order.isDeleted = true;
    await order.save();

    return res.json({ ok: true, id, softDeleted: true });
  } catch (e) {
    return res.status(500).json({ message: "Failed to delete order", error: e.message });
  }
});

/* ===================== FILTER (GET/POST) ===================== */
async function filterHandler(req, res) {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin") {
      return res.status(403).json({ message: "Forbidden: only admins can view all orders" });
    }

    const src = req.method === "GET" ? req.query : req.body;
    const { UserId, VendorId, status, startDate, endDate, page, pageSize } = src;

    const where = {};
    if (UserId) where.UserId = Number(UserId);
    if (VendorId) where.VendorId = Number(VendorId);
    if (status) where.status = status;

    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if ((startDate && !start) || (endDate && !end)) {
      return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD or ISO 8601." });
    }
    if (start || end) {
      where.createdAt = {};
      if (start) where.createdAt[Op.gte] = start;
      if (end) where.createdAt[Op.lte] = end;
    }

    const p = Math.max(1, Number(page) || 1);
    aconst = 0; // harmless no-op to avoid accidental hoists in editors; safe to keep or remove
    const sz = Math.max(1, Math.min(200, Number(pageSize) || 50));

    const { count, rows } = await Order.findAndCountAll({
      where,
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine", "commissionRate"] },
        { model: OrderItem, include: [{ model: MenuItem, attributes: ["id", "name", "price"] }] },
      ],
      order: [["createdAt", "DESC"]],
      limit: sz,
      offset: (p - 1) * sz,
    });

    return res.json({
      items: rows,
      total: count,
      page: p,
      pageSize: sz,
      totalPages: Math.ceil(count / sz),
    });
  } catch (err) {
    console.error("GET/POST /orders/filter error:", err);
    return res.status(500).json({ message: "Error filtering orders", error: err.message });
  }
}
router.get("/filter", authenticateToken, filterHandler);
router.post("/filter", authenticateToken, filterHandler);

/* ===================== PAYMENT STATUS ===================== */
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
      } catch {}
    }
    const isOwnerVendor = vendorIdClaim && Number(order.VendorId) === Number(vendorIdClaim);
    const isAdmin = role === "admin";

    if (!(isOwnerVendor || isAdmin)) {
      return res.status(403).json({ message: "Not authorized to update payment for this order" });
    }

    if (["rejected"].includes((order.status || "").toLowerCase())) {
      return res.status(400).json({ message: `Cannot set payment on a ${order.status} order` });
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
        status === "paid" ? "Thanks! Your payment is confirmed."
        : status === "failed" ? "Payment failed. Please try again."
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

/* ===================== INVOICE: HTML ===================== */
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
<html lang="en">
  <head><meta charset="utf-8"><title>Invoice #${order.id}</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#222}
    h1{margin:0 0 8px 0} .muted{color:#666}.right{text-align:right}
    table{border-collapse:collapse;width:100%;margin-top:12px}
    th,td{border:1px solid #ddd;padding:8px}
    th{background:#f7f7f7}
  </style></head>
  <body>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div><h1>Invoice #${order.id}</h1>
      <div class="muted">Created: ${createdAt}</div></div>
      ${LOGO ? `<img src="${LOGO}" alt="logo" style="height:48px">` : ""}
    </div>
    <p><strong>User:</strong> ${escapeHtml(order.User?.name || "-")} (${escapeHtml(order.User?.email || "-")})</p>
    <p><strong>Vendor:</strong> ${escapeHtml(order.Vendor?.name || "-")} (${escapeHtml(order.Vendor?.cuisine || "-")})</p>
    <table>
      <thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="4" class="muted">No items</td></tr>`}</tbody>
    </table>
    <p><strong>Subtotal:</strong> ${fmtINR(computedSubTotal)}</p>
    <p><strong>Payment:</strong> ${escapeHtml(paymentMethod)} · ${escapeHtml(paymentStatus)} ${paidAt ? `· Paid at ${paidAt}` : ""}</p>
  </body>
</html>`;
}

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

/* ===================== INVOICE: PDF (optional) ===================== */
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

/* ===================== PAYOUTS ===================== */

// ✅ VENDOR PAYOUT SUMMARY
router.get("/payouts/summary", authenticateToken, async (req, res) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "vendor") return res.status(403).json({ message: "Vendor only" });

    // resolve vendor ID from token or attached vendor record
    const VendorId = req.user?.VendorId || req.user?.vendorId || null;
    if (!VendorId) return res.status(400).json({ message: "Missing VendorId" });

    // optional date filters
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const createdAt = {};
    if (from) createdAt[Op.gte] = from;
    if (to) createdAt[Op.lte] = new Date(new Date(to).setHours(23, 59, 59, 999));

    const where = {
      VendorId,
      status: { [Op.notIn]: ["rejected"] },
      paymentStatus: "paid",
      ...(from || to ? { createdAt } : {}),
    };

    const [agg] = await Order.findAll({
      attributes: [
        [fn("COUNT", col("Order.id")), "paidOrders"],
        [fn("SUM", col("totalAmount")), "grossPaid"],
      ],
      where,
      raw: true,
    });

    const paidOrders = Number(agg?.paidOrders || 0);
    const grossPaid = Number(agg?.grossPaid || 0);
    const commission = +(grossPaid * COMMISSION_PCT).toFixed(2);
    const netOwed = +(grossPaid - commission).toFixed(2);

    // unpaid
    const [unpaidAgg] = await Order.findAll({
      attributes: [[fn("SUM", col("totalAmount")), "grossUnpaid"]],
      where: { ...where, paymentStatus: { [Op.ne]: "paid" } },
      raw: true,
    });
    const grossUnpaid = Number(unpaidAgg?.grossUnpaid || 0);

    return res.json({
      VendorId,
      paidOrders,
      grossPaid: +grossPaid.toFixed(2),
      commission,
      netOwed,
      grossUnpaid: +grossUnpaid.toFixed(2),
      rate: COMMISSION_PCT,
    });
  } catch (err) {
    console.error("❌ payouts/summary (vendor) error:", err);
    return res.status(500).json({ message: "Failed to compute vendor payouts" });
  }
});

// ✅ ADMIN PAYOUT SUMMARY
router.get("/payouts/summary/all", authenticateToken, async (req, res) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin") return res.status(403).json({ message: "Admin only" });

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const createdAt = {};
    if (from) createdAt[Op.gte] = from;
    if (to) createdAt[Op.lte] = new Date(new Date(to).setHours(23, 59, 59, 999));

    const where = {
      status: { [Op.notIn]: ["rejected"] },
      paymentStatus: "paid",
      ...(from || to ? { createdAt } : {}),
    };

    const rows = await Order.findAll({
      attributes: [
        "VendorId",
        [fn("COUNT", col("Order.id")), "paidOrders"],
        [fn("SUM", col("totalAmount")), "grossPaid"],
      ],
      where,
      include: [{ model: Vendor, attributes: ["id", "name"] }],
      group: ["VendorId", "Vendor.id"],
      order: [[fn("SUM", col("totalAmount")), "DESC"]],
      raw: false,
    });

    const out = (rows || []).map((r) => {
      const grossPaid = Number(r.get?.("grossPaid") ?? r.grossPaid ?? 0) || 0;
      const paidOrders = Number(r.get?.("paidOrders") ?? r.paidOrders ?? 0) || 0;
      const commission = +(grossPaid * COMMISSION_PCT).toFixed(2);
      const netOwed = +(grossPaid - commission).toFixed(2);
      return {
        vendorId: r.VendorId,
        vendorName: r.Vendor?.name || `#${r.VendorId}`,
        paidOrders,
        grossPaid: +grossPaid.toFixed(2),
        commission,
        netOwed,
        rate: COMMISSION_PCT,
      };
    });

    return res.json(out);
  } catch (err) {
    console.error("❌ payouts/summary/all error:", err);
    return res.json([]);
  }
});

// ===================== GET SINGLE ORDER =====================
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!Number.isFinite(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    // If your Order model is paranoid and you might soft-delete, add { paranoid: false }
    const order = await Order.findByPk(orderId, {
      // paranoid: false,
      include: [
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        {
          model: MenuItem,
          attributes: ["id", "name", "price"],
          through: { attributes: ["quantity"] },
        },
      ],
    });

    if (!order) return res.status(404).json({ message: "Order not found" });

    // AuthZ: owner, vendor for this order, or admin can view
    const role = req.user?.role || "user";
    const isOwner = Number(order.UserId) === Number(req.user.id);
    const isVendor =
      role === "vendor" && Number(order.VendorId) === Number(req.user.VendorId);
    const isAdmin = role === "admin";

    if (!(isOwner || isVendor || isAdmin)) {
      return res.status(403).json({ message: "Not authorized to view this order" });
    }

    const j = order.toJSON();
    const status = String(j.status || "").toLowerCase();
    const paymentStatus = String(j.paymentStatus || "").toLowerCase();

    const refundStatusExplicit = j.refundStatus ?? null;
    const refundAmountExplicit = j.refundAmount ?? null;
    const refundedAtExplicit = j.refundedAt ?? null;

    const refundStatus =
      refundStatusExplicit ??
      (paymentStatus === "paid" &&
        (status === "cancelled" || status === "rejected")
        ? "pending"
        : null);

    const paidTotal = Number(j.totalAmount ?? j.subtotal ?? j.total ?? 0);
    const refundAmount = Number(refundAmountExplicit ?? 0);

    return res.json({
      ...j,
      refund: {
        status: refundStatus,        // "pending" | "approved" | "failed" | null
        amount: refundAmount,        // 0 if not set
        paidTotal,
        refundedAt: refundedAtExplicit,
      },
    });
  } catch (err) {
    console.error("GET /orders/:id failed:", err);
    res.status(500).json({ message: "Failed to fetch order", error: err.message });
  }
});

/* ===================== DEBUG: SCAN VENDORS ===================== */
router.get(
  "/vendor/debug/scan",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const ids = await buildVendorScope(req);
      const perVendor = {};
      for (const id of ids) {
        perVendor[id] = await Order.count({ where: { VendorId: id } });
      }
      res.json({ userId: req.user.id, vendorIds: ids, perVendor });
    } catch (e) {
      res.status(500).json({ message: "debug scan failed", error: e.message });
    }
  }
);

module.exports = router;