
// routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { Op, Sequelize } = require("sequelize");

const { User, Vendor, Order, MenuItem } = require("../models");
const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");

// ---------- config ----------
const DEFAULT_PLATFORM_RATE = Number(process.env.PLATFORM_RATE || 0.15);
const NON_REVENUE_STATUSES = ["rejected", "canceled", "cancelled"];

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

// ======================================================
//  OVERVIEW  →  /api/admin/overview
// ======================================================
router.get("/overview", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const [users, vendors, orders] = await Promise.all([
      User.count(),
      Vendor.count(),
      Order.count(),
    ]);

    // lifetime paid & non-canceled revenue
    const paidOrders = await Order.findAll({
      where: { paymentStatus: "paid", status: { [Op.notIn]: NON_REVENUE_STATUSES } },
      include: [{ model: Vendor, attributes: ["id", "commissionRate"] }],
      attributes: ["id", "totalAmount", "VendorId", "createdAt"],
      raw: true,
      nest: true,
    });

    const totalRevenue = money(
      paidOrders.reduce((s, o) => s + Number(o.totalAmount || 0), 0)
    );
    const totalCommission = money(paidOrders.reduce((s, o) => s + commissionFor(o), 0));

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthCommission = money(
      paidOrders
        .filter((o) => new Date(o.createdAt) >= monthStart)
        .reduce((s, o) => s + commissionFor(o), 0)
    );

    res.json({
      totals: {
        users,
        vendors,
        orders,
        revenue: totalRevenue,
        commission: totalCommission,
        commissionThisMonth: monthCommission,
      },
      rate: DEFAULT_PLATFORM_RATE,
    });
  } catch (err) {
    console.error("overview error:", err);
    res.status(500).json({ message: "Overview fetch failed", error: err.message });
  }
});

// ======================================================
//  USERS (paginated)  →  /api/admin/users
//    q, role, status, page, pageSize
// ======================================================
router.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, pageSize } = parsePage(req.query);
    const where = {};
    if (req.query.role) where.role = req.query.role;
    if (req.query.status) where.status = req.query.status;
    if (req.query.q) {
      where[Op.or] = [like("name", req.query.q), like("email", req.query.q)].filter(Boolean);
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: ["id", "name", "email", "role", "status", "createdAt"],
      order: [["id", "ASC"]],
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
    res.status(500).json({ message: "Users fetch failed", error: err.message });
  }
});

// Create / Update / Delete users (unchanged APIs)
router.post("/users", authenticateToken, requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "All fields are required" });
  }
  try {
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(409).json({ message: "Email already in use" });
    const user = await User.create({ name, email, password, role });
    res.status(201).json({ message: "User created", user });
  } catch (err) {
    res.status(500).json({ message: "User creation failed", error: err.message });
  }
});

router.put("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.name = name ?? user.name;
    user.email = email ?? user.email;
    user.role = role ?? user.role;
    if (password) user.password = await bcrypt.hash(password, 10);
    await user.save();
    res.json({ message: "User updated successfully", user });
  } catch (err) {
    res.status(500).json({ message: "Failed to update user", error: err.message });
  }
});

router.delete("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    await user.destroy();
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: "User deletion failed", error: err.message });
  }
});

router.put("/promote/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.role = "vendor";
    await user.save();
    res.json({ message: "User promoted to vendor successfully", user });
  } catch (err) {
    res.status(500).json({ message: "Failed to promote user", error: err.message });
  }
});

// ======================================================
//  VENDORS (paginated)  →  /api/admin/vendors
//    q, status=open|closed, userId, page, pageSize
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

// Create / Update / Delete vendors
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
      if (rateNum > 1) rateNum = rateNum / 100; // allow "15" to mean 15%
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

// Quick vendor filter list used by UI chips/search
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
//    page, pageSize, status, paymentStatus, vendorId, userId, from, to
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
//  INSIGHTS (unchanged)
// ======================================================
router.get("/insights", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const recentOrders = await Order.findAll({
      attributes: [
        [Sequelize.fn("DATE", Sequelize.col("createdAt")), "date"],
        [Sequelize.fn("COUNT", Sequelize.col("id")), "orderCount"],
        [Sequelize.fn("SUM", Sequelize.col("totalAmount")), "totalRevenue"],
      ],
      group: [Sequelize.fn("DATE", Sequelize.col("createdAt"))],
      order: [[Sequelize.fn("DATE", Sequelize.col("createdAt")), "DESC"]],
      limit: 7,
    });

    const topItems = await MenuItem.findAll({
      attributes: ["id", "name", [Sequelize.fn("SUM", Sequelize.col("OrderItem.quantity")), "totalSold"]],
      include: [{ model: Order, attributes: [], through: { attributes: ["quantity"] } }],
      group: ["MenuItem.id"],
      order: [[Sequelize.literal("totalSold"), "DESC"]],
      limit: 5,
    });

    res.json({ recentOrders, topItems });
  } catch (err) {
    res.status(500).json({ message: "Insights fetch failed", error: err.message });
  }
});

module.exports = router;