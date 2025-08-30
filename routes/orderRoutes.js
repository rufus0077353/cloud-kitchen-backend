// routes/orderRoutes.js
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

// ---------- helpers ----------
function parsePageParams(q) {
  const page = Math.max(1, Number(q.page) || 0);      // 0 means no pagination (legacy)
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
  return { page, pageSize };
}

// ----------------- user orders (optionally paginated) -----------------
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

// ----------------- vendor (current) orders — optionally paginated -----------------
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

// ----------------- vendor summary (keep before /vendor/:vendorId) -----------------
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

      const nonRejectedWhere = { VendorId: vendorId, status: { [Op.ne]: "rejected" } };

      const [totalOrders, lifetimeRevenue] = await Promise.all([
        Order.count({ where: { VendorId: vendorId } }),
        Order.sum("totalAmount", { where: nonRejectedWhere }),
      ]);

      const ST = ["pending", "accepted", "ready", "delivered", "rejected"];
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

// GET /api/orders/vendor/daily?days=14  — unchanged (for charts)
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

      const sequelize = Order.sequelize;
      const [rows] = await sequelize.query(
        `
        SELECT
          to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
          COUNT(*) FILTER (WHERE status <> 'rejected')                                  AS orders,
          COALESCE(SUM(CASE WHEN status <> 'rejected' THEN "totalAmount" END), 0)       AS revenue
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

// ----------------- vendor (any) orders by id (legacy) -----------------
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
    const { VendorId, items, paymentMethod = "cod" } = req.body;

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
      paymentMethod,                 // 👈 capture method
      paymentStatus: "unpaid",       // 👈 default
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

// HTML invoice (download/print from UI)
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

    // ---- helpers ----
    const escapeHtml = (s = "") =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const fmtINR = (n) => `₹${Number(n || 0).toFixed(2)}`;

    const items = Array.isArray(order.MenuItems) ? order.MenuItems : [];
    const rowsHtml = items
      .map((item) => {
        const qty = Number(item?.OrderItem?.quantity || 1);
        const price = Number(item?.price || 0);
        const lineTotal = price * qty;
        return `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td class="right">${qty}</td>
            <td class="right">${fmtINR(price)}</td>
            <td class="right">${fmtINR(lineTotal)}</td>
          </tr>`;
      })
      .join("");

    const computedSubTotal = items.reduce(
      (sum, item) => sum + Number(item?.price || 0) * Number(item?.OrderItem?.quantity || 1),
      0
    );

    // Optional: show a logo if you set INVOICE_LOGO_URL in env
    const LOGO = process.env.INVOICE_LOGO_URL || "";

    const paymentMethod =
      order.paymentMethod === "mock_online" ? "Online (Mock)" : (order.paymentMethod || "COD");
    const paymentStatus = order.paymentStatus || "unpaid";
    const paidAt = order.paidAt ? new Date(order.paidAt).toLocaleString("en-IN") : "";

    const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleString("en-IN") : "-";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Invoice #${order.id}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root{
    --ink:#111; --muted:#6b7280; --line:#e5e7eb; --brand:#111827;
  }
  *{ box-sizing: border-box; }
  body{
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
    color: var(--ink);
    margin: 0; padding: 24px;
    background: #fff;
  }
  .wrap{ max-width: 860px; margin: 0 auto; }
  header{
    display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px;
  }
  .brand{ display:flex; align-items:center; gap:12px; }
  .brand img{ max-height: 48px; width: auto; }
  h1{ margin:0; font-size: 20px; }
  .muted{ color: var(--muted); }
  .grid{
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0 24px;
  }
  .card{
    border: 1px solid var(--line); border-radius: 10px; padding: 14px;
  }
  table{ width: 100%; border-collapse: collapse; }
  thead th{
    text-align: left; font-size: 12px; color: var(--muted);
    border-bottom: 1px solid var(--line); padding: 10px 8px;
  }
  tbody td{ padding: 10px 8px; border-bottom: 1px solid var(--line); }
  .right{ text-align: right; }
  .totals{
    display: grid; grid-template-columns: 1fr 280px; gap: 16px; margin-top: 12px; align-items: start;
  }
  .totals .box{
    border: 1px solid var(--line); border-radius: 10px; padding: 12px;
  }
  .totals .row{ display:flex; justify-content: space-between; margin: 6px 0; }
  .grand{ font-weight: 700; font-size: 16px; }
  .badge{
    display:inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; border:1px solid var(--line);
  }
  .paid{ background:#ecfdf5; border-color:#a7f3d0; }
  .unpaid{ background:#f9fafb; }
  .failed{ background:#fef2f2; border-color:#fecaca; }
  .actions{ margin: 18px 0 8px; }
  .btn{
    background:#111827; color:#fff; border:0; padding:10px 14px; border-radius:8px; cursor:pointer;
  }
  @media print {
    .no-print, .actions { display: none !important; }
    body{ padding: 0; }
    @page { size: A4; margin: 14mm; }
  }
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

    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    return res.status(500).json({ message: "Error generating invoice", error: err.message });
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