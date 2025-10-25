
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { Op, Sequelize } = require("sequelize");


// ✅ include Payout here as well
const { User, Vendor, Order, MenuItem, Payout, PayoutLog } = require("../models");
const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");

// ---------- config ----------
const DEFAULT_PLATFORM_RATE = Number(process.env.PLATFORM_RATE || 0.15);
// ✅ only enum values
const NON_REVENUE_STATUSES = ["rejected"];

// ---------- helpers ----------
const money = (n) => Number((Number(n || 0)).toFixed(2));
const toNum = (v, d = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const parsePage = (q) => {
  const page = Math.max(1, toNum(q.page, 1));
  const pageSize = Math.min(100, Math.max(1, toNum(q.pageSize, 20)));
  return { page, pageSize };
};
const like = (field, q) => (q ? { [field]: { [Op.iLike]: `%${q}%` } } : null);

const commissionFor = (orderPlain) => {
  const total = Number(orderPlain?.totalAmount || 0);
  const rate =
    orderPlain?.Vendor?.commissionRate != null
      ? Number(orderPlain.Vendor.commissionRate)
      : DEFAULT_PLATFORM_RATE;
  return money(total * (Number.isFinite(rate) ? rate : DEFAULT_PLATFORM_RATE));
};

/** Ensure a Vendor profile exists for this user (when role is 'vendor'). */
async function ensureVendorProfileForUser(user) {
  if (!user) return null;
  let vendor = await Vendor.findOne({ where: { UserId: user.id } });
  if (!vendor) {
    vendor = await Vendor.create({
      name: user.name || `Vendor ${user.id}`,
      cuisine: "",
      location: "",
      UserId: user.id,
      isOpen: true,
      commissionRate: DEFAULT_PLATFORM_RATE,
    });
  }
  return vendor;
}


// ======================================================
//  OVERVIEW  →  /api/admin/overview  (same shape + commission fields)
// ======================================================
router.get("/overview", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const [usersCount, vendorsCount, ordersCount] = await Promise.all([
      User.count(),
      Vendor.count(),
      Order.count(),
    ]);

    const PAID = "paid";

    // ----- revenue today / total revenue (unchanged) -----
    const revenueToday =
      Number(
        await Order.sum("totalAmount", {
          where: {
            paymentStatus: PAID,
            createdAt: {
              [Op.gte]: (() => {
                const d = new Date();
                d.setHours(0, 0, 0, 0);
                return d;
              })(),
            },
          },
        })
      ) || 0;

    const totalRevenue =
      Number(
        await Order.sum("totalAmount", { where: { paymentStatus: PAID } })
      ) || 0;

    // ================= COMMISSION TOTALS (added) =================
    const DEFAULT_RATE = Number(process.env.PLATFORM_RATE || 0.15);

    const normalizeRate = (r) => {
      let n = Number(r);
      if (!Number.isFinite(n)) return NaN;
      // accept either 0.1 or 10 for 10%
      if (n > 1) n = n / 100;
      if (n < 0) n = 0;
      return n;
    };

    const explicitCommissionOf = (o) => {
      // try common explicit fields if you happened to store them per order
      const v =
        o.commission ??
        o.commissionAmount ??
        o.platformCommission ??
        o.platformFee;
      return v != null ? Number(v) || 0 : null;
    };

    // pull paid orders with vendor so we can compute using vendor rate when needed
    const paidOrders = await Order.findAll({
      where: { paymentStatus: PAID },
      include: [{ model: Vendor, attributes: ["commissionRate"] }],
      // no `raw` → we can safely use .toJSON()
    });

    let totalCommission = 0;
    let monthCommission = 0;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    for (const row of paidOrders) {
      const o = row?.toJSON ? row.toJSON() : row;
      const total = Number(o?.totalAmount || 0);

      // 1) explicit field on order, if present
      const explicit = explicitCommissionOf(o);
      let commission;

      if (explicit != null) {
        commission = Math.max(0, explicit);
      } else {
        // 2) order.commissionRate -> 3) vendor.commissionRate -> 4) DEFAULT
        const orderRate = normalizeRate(o?.commissionRate);
        const vendorRate = normalizeRate(o?.Vendor?.commissionRate);
        const rate = Number.isFinite(orderRate)
          ? orderRate
          : Number.isFinite(vendorRate)
          ? vendorRate
          : DEFAULT_RATE;

        commission = Math.max(0, total * rate);
      }

      totalCommission += commission;

      const createdTs = o?.createdAt ? new Date(o.createdAt).getTime() : 0;
      if (createdTs >= monthStart) monthCommission += commission;
    }
    // ================= /commission totals =================

    // ----- status counts (unchanged) -----
    const statuses = ["pending", "accepted", "ready", "delivered", "rejected"];
    const statusCounts = {};
    await Promise.all(
      statuses.map(async (s) => {
        statusCounts[s] = await Order.count({ where: { status: s } });
      })
    );

    // ----- last 7 days (unchanged) -----
    const since = new Date();
    since.setDate(since.getDate() - 6);
    since.setHours(0, 0, 0, 0);

    const rows = await Order.findAll({
      attributes: [
        [Sequelize.fn("DATE", Sequelize.col("createdAt")), "day"],
        [Sequelize.fn("COUNT", Sequelize.col("id")), "orders"],
        [
          Sequelize.literal(
            `SUM(CASE WHEN "paymentStatus"='paid' THEN "totalAmount" ELSE 0 END)`
          ),
          "revenue",
        ],
      ],
      where: { createdAt: { [Op.gte]: since } },
      group: [Sequelize.fn("DATE", Sequelize.col("createdAt"))],
      order: [[Sequelize.fn("DATE", Sequelize.col("createdAt")), "ASC"]],
      raw: true,
    });

    const map = new Map(
      rows.map((r) => [
        String(r.day),
        { orders: Number(r.orders) || 0, revenue: Number(r.revenue) || 0 },
      ])
    );
    const last7Days = [];
    const cur = new Date(since);
    for (let i = 0; i < 7; i++) {
      const key = cur.toISOString().slice(0, 10);
      const v = map.get(key) || { orders: 0, revenue: 0 };
      last7Days.push({ day: key, orders: v.orders, revenue: v.revenue });
      cur.setDate(cur.getDate() + 1);
    }

    // ✅ same fields as before + commission fields
    res.json({

      //existing fields
      totalUsers: usersCount,
      totalVendors: vendorsCount,
      totalOrders: ordersCount,

      
      usersCount,
      vendorsCount,
      ordersCount,
      totalRevenue,
      revenueToday,
      statusCounts,
      last7Days,
      totalCommission: Number(totalCommission.toFixed(2)),
      monthCommission: Number(monthCommission.toFixed(2)),
    });
  } catch (err) {
    console.error("overview error:", err);
    res.status(500).json({ message: "Overview failed", error: err.message });
  }
});

// ======================================================
//  USERS (paginated)  →  /api/admin/users
// ======================================================

router.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const search   = (req.query.q || req.query.search || "").trim();
    const role     = (req.query.role || "").trim();
    const status   = (req.query.status || "").trim();

    const where = {};
    if (role)   where.role = role;
    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { name:  { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: { exclude: ["password"] },
      order: [["createdAt", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    res.json({
      items: rows,
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize),
    });
  } catch (err) {
    console.error("ADMIN /users failed:", err);
    res.status(500).json({ message: "Users fetch failed", error: err.message });
  }
});

/** CREATE USER (Admin) */
router.post("/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role = "user" } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email, password are required" });
    }
    if (!["user", "vendor", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(409).json({ message: "Email already in use" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed, role });

    let vendor = null;
    if (role === "vendor") vendor = await ensureVendorProfileForUser(user);

    const plain = user.toJSON(); delete plain.password;
    res.status(201).json({
      message: "User created",
      user: plain,
      vendor: vendor ? { id: vendor.id, UserId: vendor.UserId } : null,
    });
  } catch (err) {
    res.status(500).json({ message: "User creation failed", error: err.message });
  }
});

/** UPDATE USER (Admin) */
router.put("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role, status } = req.body || {};
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name != null)  user.name = name;
    if (email != null) user.email = email;
    if (role != null)  user.role = role;
    if (status != null && "status" in user) user.status = status;
    if (password) user.password = await bcrypt.hash(password, 10);

    await user.save();

    let vendor = null;
    if (role === "vendor") vendor = await ensureVendorProfileForUser(user);

    const plain = user.toJSON(); delete plain.password;
    res.json({
      message: "User updated successfully",
      user: plain,
      vendor: vendor ? { id: vendor.id, UserId: vendor.UserId } : null,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to update user", error: err.message });
  }
});

// PATCH /api/admin/users/:id
router.patch("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isDeleted } = req.body || {};
    if (typeof isDeleted !== "boolean") {
      return res.status(400).json({ message: "isDeleted boolean is required" });
    }
    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.isDeleted = isDeleted;
    await user.save();

    return res.json({
      message: isDeleted ? "User archived" : "User restored",
      user: { id: user.id, isDeleted: user.isDeleted },
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update user", error: err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    await Vendor.destroy({ where: { UserId: id } });
    await user.destroy();

    return res.json({ message: "User deleted", ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete user", error: err.message });
  }
});

/** CHANGE ROLE ONLY */
router.put("/users/:id/role", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!["user", "vendor", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.role = role;
    await user.save();

    let vendor = null;
    if (role === "vendor") vendor = await ensureVendorProfileForUser(user);

    const plain = user.toJSON(); delete plain.password;
    res.json({
      message: `Role set to '${role}'`,
      user: plain,
      vendor: vendor ? { id: vendor.id, UserId: vendor.UserId } : null,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to update role", error: err.message });
  }
});

/** Backwards-compatible promote route */
router.put("/promote/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.role = "vendor";
    await user.save();
    const vendor = await ensureVendorProfileForUser(user);
    const plain = user.toJSON(); delete plain.password;
    res.json({
      message: "User promoted to vendor successfully",
      user: plain,
      vendor: vendor ? { id: vendor.id, UserId: vendor.UserId } : null,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to promote user", error: err.message });
  }
});

// ======================================================
//  VENDORS (paginated)  →  /api/admin/vendors
// ======================================================
router.get("/vendors", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, pageSize } = parsePage(req.query);
    const where = {};
    if (req.query.status === "open") where.isOpen = true;
    if (req.query.status === "closed") where.isOpen = false;
    if (req.query.userId) where.UserId = toNum(req.query.userId);

    if (req.query.q) {
      where[Op.or] = [
        like("name", req.query.q),
        like("location", req.query.q),
        like("cuisine", req.query.q),
      ].filter(Boolean);
    }

    const { count, rows } = await Vendor.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    res.json({
      items: rows,
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize),
    });
  } catch (err) {
    res.status(500).json({ message: "Vendors fetch failed", error: err.message });
  }
});

router.post("/vendors", authenticateToken, requireAdmin, async (req, res) => {
  const { name, cuisine, location, UserId, isOpen, commissionRate } = req.body || {};
  if (!name || !cuisine) return res.status(400).json({ message: "Name and cuisine are required" });

  try {
    const newVendor = await Vendor.create({
      name,
      cuisine,
      location: location ?? "",
      UserId: UserId ?? null,
      isOpen: typeof isOpen === "boolean" ? isOpen : true,
      commissionRate:
        commissionRate != null ? Number(commissionRate) : DEFAULT_PLATFORM_RATE,
    });
    res.status(201).json({ message: "Vendor created", vendor: newVendor });
  } catch (err) {
    res.status(500).json({ message: "Vendor creation failed", error: err.message });
  }
});

router.put("/vendors/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const { name, cuisine, location, UserId, isOpen, commissionRate } = req.body || {};
    if (name != null) vendor.name = name;
    if (cuisine != null) vendor.cuisine = cuisine;
    if (location != null) vendor.location = location;
    if (UserId != null) vendor.UserId = UserId;
    if (typeof isOpen === "boolean") vendor.isOpen = isOpen;
    if (commissionRate != null && commissionRate !== "") {
      let rateNum = Number(commissionRate);
      if (rateNum > 1) rateNum = rateNum / 100;
      vendor.commissionRate = rateNum;
    }

    await vendor.save();
    res.json({ message: "Vendor updated", vendor });
  } catch (err) {
    res.status(500).json({ message: "Vendor update failed", error: err.message });
  }
});

router.delete("/vendors/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    await vendor.destroy();
    res.json({ message: "Vendor deleted" });
  } catch (err) {
    res.status(500).json({ message: "Vendor deletion failed", error: err.message });
  }
});

// Quick vendor filter
router.get("/filter", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const where = {};
    if (req.query.status === "open") where.isOpen = true;
    if (req.query.status === "closed") where.isOpen = false;
    if (req.query.q) {
      where[Op.or] = [
        like("name", req.query.q),
        like("location", req.query.q),
        like("cuisine", req.query.q),
      ].filter(Boolean);
    }
    const vendors = await Vendor.findAll({
      where,
      attributes: ["id", "name", "location", "cuisine", "isOpen", "commissionRate"],
      order: [["createdAt", "DESC"]],
      limit: 200,
    });
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: "Failed to filter vendors", error: err.message });
  }
});

// ======================================================
//  ORDERS (paginated)  →  /api/admin/orders
// ======================================================
router.get("/orders", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, pageSize } = parsePage(req.query);

    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;
    if (req.query.vendorId) where.VendorId = toNum(req.query.vendorId);
    if (req.query.userId) where.UserId = toNum(req.query.userId);

    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt[Op.gte] = new Date(req.query.from);
      if (req.query.to) where.createdAt[Op.lte] = new Date(req.query.to);
    }

    const { count, rows } = await Order.findAndCountAll({
      where,
      include: [
        { model: Vendor, attributes: ["id", "name", "commissionRate"] },
        { model: User, attributes: ["id", "name", "email"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    const items = rows.map((o) => {
      const plain = o.toJSON();
      const total = Number(plain.totalAmount || 0);
      const rate =
        plain?.Vendor?.commissionRate != null
          ? Number(plain.Vendor.commissionRate)
          : DEFAULT_PLATFORM_RATE;
      const commissionAmount = money(total * (Number.isFinite(rate) ? rate : DEFAULT_PLATFORM_RATE));
      const vendorPayout = money(total - commissionAmount);
      return {
        ...plain,
        commissionRate: Number.isFinite(rate) ? rate : DEFAULT_PLATFORM_RATE,
        commissionAmount,
        vendorPayout,
      };
    });

    res.json({
      items,
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize),
      rate: DEFAULT_PLATFORM_RATE,
    });
  } catch (err) {
    console.error("ADMIN /orders failed:", err);
    res.status(500).json({ message: "Orders fetch failed", error: err.message });
  }
});




// ======================================================
//  ADMIN INSIGHTS (robust + OrderItem-safe)
// ======================================================

router.get("/insights", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    // -------- dialect-safe date expr --------
    const dialect = sequelize.getDialect();
    let dateExpr;
    if (dialect === "postgres") {
      dateExpr = Sequelize.literal(`DATE("createdAt")`);
    } else if (dialect === "mysql") {
      dateExpr = Sequelize.literal(`DATE(createdAt)`);
    } else {
      // sqlite fallback
      dateExpr = Sequelize.literal(`strftime('%Y-%m-%d', createdAt)`);
    }

    // -------- recent orders (last 7 buckets) --------
    const recent = await Order.findAll({
      attributes: [
        [dateExpr, "date"],
        [Sequelize.fn("COUNT", Sequelize.col("id")), "orderCount"],
        [Sequelize.fn("SUM", Sequelize.col("totalAmount")), "totalRevenue"],
      ],
      group: ["date"],
      order: [[Sequelize.literal("date"), "DESC"]],
      limit: 7,
      raw: true,
    });

    const recentOrders = recent.map((r) => ({
      date: String(r.date),
      orderCount: Number(r.orderCount || 0),
      totalRevenue: Number(r.totalRevenue || 0),
    }));

    // -------- top items (defensive if OrderItem missing) --------
    let topItems = [];
    if (OrderItem) {
      const topItemsRaw = await OrderItem.findAll({
        attributes: [
          "MenuItemId",
          [Sequelize.fn("SUM", Sequelize.col("quantity")), "totalSold"],
        ],
        include: [{ model: MenuItem, attributes: ["id", "name"] }],
        group: ["OrderItem.MenuItemId", "MenuItem.id"],
        order: [[Sequelize.literal("totalSold"), "DESC"]],
        limit: 5,
        raw: true,
        nest: true,
      });

      topItems = topItemsRaw.map((r) => ({
        id: Number(r.MenuItem?.id ?? r.MenuItemId),
        name: r.MenuItem?.name ?? `Item #${r.MenuItemId}`,
        totalSold: Number(r.totalSold || 0),
      }));
    } else {
      // If your join model isn’t exported/registered, don’t crash — just return empty list.
      console.warn("[admin/insights] OrderItem model not found — returning empty topItems.");
      topItems = [];
    }

    return res.json({ recentOrders, topItems });
  } catch (err) {
    console.error("ADMIN /insights failed:", err?.message || err);

    // -------- final fallback: simple compute without group by --------
    try {
      const since = new Date();
      since.setDate(since.getDate() - 7);
      since.setHours(0, 0, 0, 0);

      const orders = await Order.findAll({
        where: { createdAt: { [Op.gte]: since } },
        attributes: ["totalAmount", "createdAt"],
        raw: true,
      });

      const byDay = {};
      for (const o of orders) {
        const k = new Date(o.createdAt).toISOString().slice(0, 10);
        if (!byDay[k]) byDay[k] = { date: k, orderCount: 0, totalRevenue: 0 };
        byDay[k].orderCount += 1;
        byDay[k].totalRevenue += Number(o.totalAmount || 0);
      }

      const recentOrders = Object.values(byDay)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 7);

      // No join model in this path → empty top items
      return res.json({ recentOrders, topItems: [] });
    } catch (inner) {
      console.error("ADMIN /insights fallback failed:", inner?.message || inner);
      return res
        .status(500)
        .json({ message: "Insights fetch failed", error: inner?.message || String(inner) });
    }
  }
});



// ======================================================
// PAYOUTS (admin): list + vendor bulk actions
// Endpoints:
//  - GET    /api/admin/payouts
//  - POST   /api/admin/payouts/backfill
//  - PATCH  /api/admin/payouts/vendor/:vendorId/pay
//  - PATCH  /api/admin/payouts/vendor/:vendorId/schedule
// ======================================================

router.get("/payouts", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const PLATFORM_RATE = Number(process.env.PLATFORM_RATE || 0.15);

    // ---------- Attempt 1: NEW payouts schema (grossAmount / commissionAmount / payoutAmount) ----------
    let rowsNew = null;
    try {
      rowsNew = await Payout.findAll({
        attributes: [
          "VendorId",
          "status",
          [Sequelize.fn("SUM", Sequelize.col("grossAmount")), "gross"],
          [Sequelize.fn("SUM", Sequelize.col("commissionAmount")), "platformFee"],
          [Sequelize.fn("SUM", Sequelize.col("payoutAmount")), "net"],
        ],
        include: [{ model: Vendor, attributes: ["id", "name", "commissionRate"] }],
        group: ["VendorId", "status", "Vendor.id"],
        raw: true,
        nest: true,
      });
    } catch (e) {
      rowsNew = null;
    }

    if (Array.isArray(rowsNew) && rowsNew.length) {
      const byVendor = new Map();
      for (const r of rowsNew) {
        const vendorId = Number(r.VendorId);
        const vendorName = r.Vendor?.name || `Vendor ${vendorId}`;
        const ratePct =
          r.Vendor?.commissionRate != null
            ? Number(r.Vendor.commissionRate) * 100
            : PLATFORM_RATE * 100;

        const cur = byVendor.get(vendorId) || {
          vendorId,
          vendorName,
          commissionRate: +Number(ratePct).toFixed(2), // already %
          gross: 0,
          platformFee: 0,
          net: 0,
          statusCounts: { pending: 0, scheduled: 0, paid: 0 },
          payableNow: 0,
        };

        const gross = Number(r.gross || 0);
        const fee = Number(r.platformFee || 0);
        const net = Number(r.net || 0);

        cur.gross += gross;
        cur.platformFee += fee;
        cur.net += net;

        const st = String(r.status || "pending").toLowerCase();
        if (cur.statusCounts[st] != null) cur.statusCounts[st] += 1;
        if (st === "pending") cur.payableNow += net;

        byVendor.set(vendorId, cur);
      }

      const items = Array.from(byVendor.values()).map(v => ({
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        commissionRate: v.commissionRate, // %
        gross: +v.gross.toFixed(2),
        platformFee: +v.platformFee.toFixed(2),
        net: +v.net.toFixed(2),
        statusCounts: v.statusCounts,
        payableNow: +v.payableNow.toFixed(2),
      }));

      const totals = items.reduce(
        (t, r) => ({
          gross: +(t.gross + r.gross).toFixed(2),
          platformFee: +(t.platformFee + r.platformFee).toFixed(2),
          net: +(t.net + r.net).toFixed(2),
          payableNow: +(t.payableNow + r.payableNow).toFixed(2),
        }),
        { gross: 0, platformFee: 0, net: 0, payableNow: 0 }
      );

      return res.json({ items, totals, source: "payouts" });
    }

    // ---------- Attempt 2: LEGACY payouts schema (amount + status) ----------
    let rowsLegacy = null;
    try {
      rowsLegacy = await Payout.findAll({
        attributes: [
          "VendorId",
          "status",
          [Sequelize.fn("SUM", Sequelize.col("amount")), "netLegacy"],
          // commission unknown in legacy: treat as 0, store rate for display only
        ],
        include: [{ model: Vendor, attributes: ["id", "name", "commissionRate"] }],
        group: ["VendorId", "status", "Vendor.id"],
        raw: true,
        nest: true,
      });
    } catch (e) {
      rowsLegacy = null;
    }

    if (Array.isArray(rowsLegacy) && rowsLegacy.length) {
      const byVendor = new Map();

      for (const r of rowsLegacy) {
        const vendorId = Number(r.VendorId);
        const vendorName = r.Vendor?.name || `Vendor ${vendorId}`;
        const ratePct =
          r.Vendor?.commissionRate != null
            ? Number(r.Vendor.commissionRate) * 100
            : PLATFORM_RATE * 100;

        const cur = byVendor.get(vendorId) || {
          vendorId,
          vendorName,
          commissionRate: +Number(ratePct).toFixed(2),
          gross: 0,
          platformFee: 0,
          net: 0,
          statusCounts: { pending: 0, scheduled: 0, paid: 0 },
          payableNow: 0,
        };

        const net = Number(r.netLegacy || 0);
        // Legacy table has only "amount" (net). We don't know gross/fee -> set gross=net, fee=0
        cur.net += net;
        cur.gross += net;

        const st = String(r.status || "pending").toLowerCase();
        if (cur.statusCounts[st] != null) cur.statusCounts[st] += 1;
        if (st === "pending") cur.payableNow += net;

        byVendor.set(vendorId, cur);
      }

      const items = Array.from(byVendor.values()).map(v => ({
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        commissionRate: v.commissionRate,
        gross: +v.gross.toFixed(2),
        platformFee: 0,
        net: +v.net.toFixed(2),
        statusCounts: v.statusCounts,
        payableNow: +v.payableNow.toFixed(2),
      }));

      const totals = items.reduce(
        (t, r) => ({
          gross: +(t.gross + r.gross).toFixed(2),
          platformFee: +(t.platformFee + r.platformFee).toFixed(2),
          net: +(t.net + r.net).toFixed(2),
          payableNow: +(t.payableNow + r.payableNow).toFixed(2),
        }),
        { gross: 0, platformFee: 0, net: 0, payableNow: 0 }
      );

      return res.json({ items, totals, source: "payouts-legacy" });
    }

    // ---------- Attempt 3: Fallback from Orders ----------
    const orders = await Order.findAll({
      where: { status: "delivered", paymentStatus: "paid" },
      include: [{ model: Vendor, attributes: ["id", "name", "commissionRate"] }],
      attributes: ["id", "VendorId", "totalAmount"],
    });

    const byVendor = new Map();
    for (const o of orders) {
      const vendorId = Number(o.VendorId);
      const vendorName = o.Vendor?.name || `Vendor ${vendorId}`;
      const rate =
        o.Vendor?.commissionRate != null ? Number(o.Vendor.commissionRate) : PLATFORM_RATE;

      const gross = Number(o.totalAmount || 0);
      const platformFee = Math.max(0, gross * (Number.isFinite(rate) ? rate : PLATFORM_RATE));
      const net = Math.max(0, gross - platformFee);

      const agg = byVendor.get(vendorId) || {
        vendorId,
        vendorName,
        commissionRate: +((Number.isFinite(rate) ? rate : PLATFORM_RATE) * 100).toFixed(2),
        gross: 0,
        platformFee: 0,
        net: 0,
        statusCounts: { pending: 0, scheduled: 0, paid: 0 },
        payableNow: 0,
      };
      agg.gross += gross;
      agg.platformFee += platformFee;
      agg.net += net;
      byVendor.set(vendorId, agg);
    }

    const items = Array.from(byVendor.values()).map(v => ({
      vendorId: v.vendorId,
      vendorName: v.vendorName,
      commissionRate: v.commissionRate,
      gross: +v.gross.toFixed(2),
      platformFee: +v.platformFee.toFixed(2),
      net: +v.net.toFixed(2),
      statusCounts: v.statusCounts,
      payableNow: 0,
    }));

    const totals = items.reduce(
      (t, r) => ({
        gross: +(t.gross + r.gross).toFixed(2),
        platformFee: +(t.platformFee + r.platformFee).toFixed(2),
        net: +(t.net + r.net).toFixed(2),
        payableNow: +(t.payableNow + r.payableNow).toFixed(2),
      }),
      { gross: 0, platformFee: 0, net: 0, payableNow: 0 }
    );

    return res.json({ items, totals, source: "orders-fallback" });
  } catch (err) {
    console.error("admin/payouts error:", err);
    res.status(500).json({ message: "Failed to load payouts", error: err.message });
  }
});

// ---------- Helpers (use PLATFORM_RATE, not DEFAULT_PLATFORM_RATE) ----------
function normalizeRate(n, fallbackPct) {
  let r = Number(n);
  if (!Number.isFinite(r)) r = Number(fallbackPct);
  // accept 10 or 0.10
  if (r > 1) r = r / 100;
  if (r < 0) r = 0;
  return r;
}

async function createPendingPayoutForOrder(orderRow) {
  const o = orderRow?.toJSON ? orderRow.toJSON() : orderRow;
  if (!o) return null;
  const exists = await Payout.findOne({ where: { OrderId: o.id } });
  if (exists) return null;

  const PLATFORM_RATE = Number(process.env.PLATFORM_RATE || 0.15);
  const gross = Number(o.totalAmount || 0);
  const rate  = normalizeRate(o?.Vendor?.commissionRate, PLATFORM_RATE);
  const fee   = Math.max(0, gross * rate);
  const net   = Math.max(0, gross - fee);

  return Payout.create({
    OrderId: o.id,
    VendorId: o.VendorId,
    status: "pending", // pending | scheduled | paid
    grossAmount: gross,
    commissionAmount: fee,
    payoutAmount: net,
  });
}

// Backfill delivered+paid orders into Payouts (pending)
// --- quick ping so you can verify Render has this code ---
router.get("/payouts/ping", authenticateToken, requireAdmin, (_req, res) => {
  res.json({ ok: true, where: "/api/admin/payouts/ping" });
});

/**
 * /api/admin/payouts/backfill
 * Accept BOTH GET and POST so it's easy to trigger.
 * Creates pending payout rows for every delivered+paid order
 * that doesn't already have one.
 */
router.all("/payouts/backfill", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    // ensure helper exists in this file (see below) or inline it
    const paidDelivered = await Order.findAll({
      where: { status: "delivered", paymentStatus: "paid" },
      include: [{ model: Vendor, attributes: ["id", "commissionRate"] }],
      attributes: ["id", "VendorId", "totalAmount"], // do NOT select Order.commissionRate if that column doesn't exist
      order: [["id", "ASC"]],
    });

    let created = 0, skipped = 0;
    for (const row of paidDelivered) {
      const exists = await Payout.findOne({ where: { OrderId: row.id } });
      if (exists) { skipped++; continue; }

      // normalize rate (accepts 0.1 or 10)
      const normalizeRate = (n, fallback) => {
        let r = Number(n);
        if (!Number.isFinite(r)) r = Number(fallback);
        if (!Number.isFinite(r)) r = Number(process.env.PLATFORM_RATE || 0.15);
        if (r > 1) r = r / 100;
        if (r < 0) r = 0;
        return r;
      };

      const gross = Number(row.totalAmount || 0);
      const rate  = normalizeRate(row?.Vendor?.commissionRate, process.env.PLATFORM_RATE || 0.15);
      const fee   = Math.max(0, gross * rate);
      const net   = Math.max(0, gross - fee);

      await Payout.create({
        OrderId: row.id,
        VendorId: row.VendorId,
        status: "pending",          // pending | scheduled | paid
        grossAmount: gross,
        commissionAmount: fee,
        payoutAmount: net,
      });
      created++;
    }

    // tell live UIs to refresh (optional)
    try { _req.app.get("io")?.emit("payments:refresh"); } catch {}

    return res.json({ ok: true, created, skipped, totalScanned: paidDelivered.length });
  } catch (err) {
    console.error("payouts/backfill error:", err);
    return res.status(500).json({ message: "Backfill failed", error: err.message });
  }
});

// Bulk mark PENDING → PAID
router.patch("/payouts/vendor/:vendorId/pay", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isFinite(vendorId)) return res.status(400).json({ message: "Invalid vendorId" });

    const [affected] = await Payout.update(
      { status: "paid", paidAt: new Date() },
      { where: { VendorId: vendorId, status: "pending" } }
    );

    await PayoutLog.create({
      VendorId: vendorId,
      action: "paid",
      adminUser: req.user?.email || `admin#${req.user?.id || "?"}`,
      note: `Bulk-mark PENDING → PAID`,
});

    req.app.get("emitToVendor")?.(vendorId, "payout:update", { VendorId: vendorId, status: "paid", bulk: true });
    return res.json({ ok: true, affected });
  } catch (err) {
    console.error("admin/pay vendor error:", err);
    res.status(500).json({ message: "Failed to mark paid", error: err.message });
  }
});

// Bulk mark PENDING → SCHEDULED
router.patch("/payouts/vendor/:vendorId/schedule", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isFinite(vendorId)) return res.status(400).json({ message: "Invalid vendorId" });

    const [affected] = await Payout.update(
      { status: "scheduled", scheduledAt: Sequelize.literal(`COALESCE("scheduledAt", NOW())`) },
      { where: { VendorId: vendorId, status: "pending" } }
    );

    await PayoutLog.create({
      VendorId: vendorId,
      action: "scheduled",
      adminUser: req.user?.email || `admin#${req.user?.id || "?"}`,
      note: `Bulk-mark PENDING → SCHEDULED`,
});

    req.app.get("emitToVendor")?.(vendorId, "payout:update", { VendorId: vendorId, status: "scheduled", bulk: true });
    return res.json({ ok: true, affected });
  } catch (err) {
    console.error("admin/schedule vendor error:", err);
    res.status(500).json({ message: "Failed to schedule", error: err.message });
  }
});


// GET /api/admin/payouts/vendor/:vendorId/details
router.get("/payouts/vendor/:vendorId/details", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isFinite(vendorId)) return res.status(400).json({ message: "Invalid vendorId" });

    const vendor = await Vendor.findByPk(vendorId, { attributes: ["id","name","commissionRate"] });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const payouts = await Payout.findAll({
      where: { VendorId: vendorId },
      order: [["createdAt","DESC"]],
      attributes: ["id","OrderId","status","grossAmount","commissionAmount","payoutAmount","utrNumber","paidOn","scheduledAt","paidAt","createdAt"],
    });

    // include delivered+paid orders (for reconciliation)
    const orders = await Order.findAll({
      where: { VendorId: vendorId, status: "delivered", paymentStatus: "paid" },
      order: [["createdAt","DESC"]],
      attributes: ["id","totalAmount","createdAt"],
    });

    const logs = await PayoutLog.findAll({
      where: { VendorId: vendorId },
      order: [["createdAt","DESC"]],
      attributes: ["id","action","adminUser","note","createdAt"],
    });

    res.json({ vendor, payouts, orders, logs });
  } catch (e) {
    res.status(500).json({ message: "Details fetch failed", error: e.message });
  }
});


// PATCH /api/admin/payouts/vendor/:vendorId/utr
router.patch("/payouts/vendor/:vendorId/utr", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isFinite(vendorId)) return res.status(400).json({ message: "Invalid vendorId" });
    const { utrNumber, paidOn, note } = req.body || {};

    const [affected] = await Payout.update(
      { utrNumber: utrNumber || null, paidOn: paidOn ? new Date(paidOn) : null },
      { where: { VendorId: vendorId, status: "paid" } } // we store UTR for paid payouts
    );

    await PayoutLog.create({
      VendorId: vendorId,
      action: "note",
      adminUser: req.user?.email || `admin#${req.user?.id || "?"}`,
      note: note || `UTR updated to ${utrNumber || "-"}`,
    });

    return res.json({ ok: true, affected });
  } catch (e) {
    res.status(500).json({ message: "UTR update failed", error: e.message });
  }
});


// GET /api/admin/payouts/vendor/:vendorId/statement?month=YYYY-MM
router.get("/payouts/vendor/:vendorId/statement", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const vendorId = Number(req.params.vendorId);
    const month = String(req.query.month || "").trim(); // "2025-10"
    if (!Number.isFinite(vendorId) || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ message: "vendorId and month=YYYY-MM required" });
    }
    const [y,m] = month.split("-").map(Number);
    const start = new Date(y, m-1, 1, 0,0,0,0);
    const end   = new Date(y, m,   1, 0,0,0,0);

    const vendor = await Vendor.findByPk(vendorId, { attributes: ["id","name"] });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const rows = await Payout.findAll({
      where: { VendorId: vendorId, createdAt: { [Op.gte]: start, [Op.lt]: end } },
      order: [["createdAt","ASC"]],
      attributes: ["id","OrderId","status","grossAmount","commissionAmount","payoutAmount","utrNumber","paidOn","createdAt"],
      raw: true,
    });

    const header = ["PayoutID","OrderID","Status","Gross","PlatformFee","Net","UTR","PaidOn","CreatedAt"];
    const lines  = rows.map(r => [
      r.id, r.OrderId, r.status,
      r.grossAmount?.toFixed(2), r.commissionAmount?.toFixed(2), r.payoutAmount?.toFixed(2),
      r.utrNumber || "", r.paidOn ? new Date(r.paidOn).toISOString() : "",
      new Date(r.createdAt).toISOString()
    ].join(","));

    res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="statement_${vendor.name}_${month}.csv"`);
    res.send("\uFEFF" + [header.join(","), ...lines].join("\n"));
  } catch (e) {
    res.status(500).json({ message: "Statement export failed", error: e.message });
  }
})

module.exports = router;