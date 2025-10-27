
// controllers/vendorController.js
const db = require("../models");
const { Vendor, User, Order, OrderItem, MenuItem, Sequelize } = db;
const { Op } = Sequelize;

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

// Recompute and persist aggregate ratings for a vendor from Orders.rating
// Call this after an order is rated, or on-demand from the dashboard.
async function recomputeVendorRatings(vendorId) {
  const row = await Order.findOne({
    where: { VendorId: vendorId, rating: { [Op.ne]: null } },
    attributes: [
      [Sequelize.fn("COUNT", Sequelize.col("Order.id")), "cnt"],
      [Sequelize.fn("AVG", Sequelize.col("Order.rating")), "avg"],
    ],
    raw: true,
  });

  const ratingCount = Number(row?.cnt || 0);
  const ratingAvg = ratingCount > 0 ? Number(row?.avg || 0) : 0;

  await Vendor.update(
    { ratingCount, ratingAvg },
    { where: { id: vendorId } }
  );

  return { ratingCount, ratingAvg };
}

/* ------------------------------------------------------------------ */
/* Public Vendor CRUD (what you already had, polished a bit)           */
/* ------------------------------------------------------------------ */

// GET /api/vendors?page=1&pageSize=20
exports.list = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = Math.max(parseInt(req.query.pageSize || "20", 10), 1);
    const offset = (page - 1) * pageSize;

    const { rows, count } = await Vendor.findAndCountAll({
      limit: pageSize,
      offset,
      order: [["id", "DESC"]],
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "role"],
          required: false,
        },
      ],
    });

    return res.json({ items: rows, total: count, page, pageSize });
  } catch (err) {
    console.error("vendors.list error:", err);
    return res.status(500).json({ message: "Failed to load vendors" });
  }
};

// GET /api/vendors/:id
exports.getOne = async (req, res) => {
  try {
    const v = await Vendor.findByPk(req.params.id, {
      include: [{ model: User, attributes: ["id", "name", "email", "role"] }],
    });
    if (!v) return res.status(404).json({ message: "Vendor not found" });
    return res.json(v);
  } catch (err) {
    console.error("vendors.getOne error:", err);
    return res.status(500).json({ message: "Failed to load vendor" });
  }
};

// POST /api/vendors
// body: { name, location?, cuisine?, phone?, imageUrl?/logoUrl?, UserId, isOpen? }
exports.create = async (req, res) => {
  try {
    const { name, UserId } = req.body;
    if (!name || !UserId) {
      return res
        .status(400)
        .json({ message: "Missing required fields (name, UserId)" });
    }

    const data = {
      name,
      UserId,
      location: req.body.location ?? null,
      cuisine: req.body.cuisine ?? null,
      phone: req.body.phone ?? null,
      // accept either imageUrl or legacy logoUrl
      imageUrl: req.body.imageUrl ?? req.body.logoUrl ?? null,
      isOpen: req.body.isOpen === undefined ? true : !!req.body.isOpen,
    };

    const created = await Vendor.create(data);
    return res.status(201).json(created);
  } catch (err) {
    console.error("vendors.create error:", err);
    return res.status(500).json({ message: "Failed to create vendor" });
  }
};

// PUT /api/vendors/:id
// body: any of { name, location, cuisine, phone, imageUrl/logoUrl, UserId, isOpen, isDeleted }
exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const v = await Vendor.findByPk(id);
    if (!v) return res.status(404).json({ message: "Vendor not found" });

    const patch = {};
    const map = {
      name: "name",
      location: "location",
      cuisine: "cuisine",
      phone: "phone",
      UserId: "UserId",
      isOpen: "isOpen",
      isDeleted: "isDeleted",
      imageUrl: "imageUrl",
      logoUrl: "imageUrl", // map legacy logoUrl -> imageUrl
      description: "description",
      etaMins: "etaMins",
      deliveryFee: "deliveryFee",
      commissionRate: "commissionRate",
    };

    for (const [k, target] of Object.entries(map)) {
      if (req.body[k] !== undefined) {
        const val =
          target === "isOpen" || target === "isDeleted"
            ? !!req.body[k]
            : req.body[k];
        patch[target] = val;
      }
    }

    Object.assign(v, patch);
    await v.save();
    res.json(v);
  } catch (err) {
    console.error("vendors.update error:", err);
    res.status(500).json({ message: "Failed to update vendor" });
  }
};

// DELETE /api/vendors/:id (hard delete)
exports.remove = async (req, res) => {
  try {
    const v = await Vendor.findByPk(req.params.id);
    if (!v) return res.status(404).json({ message: "Vendor not found" });

    await v.destroy();
    return res.json({ success: true });
  } catch (err) {
    console.error("vendors.remove error:", err);
    return res.status(500).json({ message: "Failed to delete vendor" });
  }
};

/* ------------------------------------------------------------------ */
/* Vendor Dashboard helpers (secure)                                   */
/* ------------------------------------------------------------------ */

// GET /api/vendors/me  → profile of the currently logged-in vendor
// (requires your auth + ensureVendorProfile middleware)
exports.getMe = async (req, res) => {
  try {
    const vendorId = req.vendor?.id || null;
    let vendor = null;

    if (vendorId) {
      vendor = await Vendor.findByPk(vendorId);
    } else if (req.user?.id) {
      // fallback if ensureVendorProfile wasn't used
      vendor = await Vendor.findOne({ where: { UserId: req.user.id } });
    }

    if (!vendor) return res.status(404).json({ message: "Vendor profile not found" });
    res.json(vendor);
  } catch (err) {
    console.error("vendors.getMe error:", err);
    res.status(500).json({ message: "Failed to fetch vendor profile" });
  }
};

// GET /api/vendor/orders  → recent orders for this vendor (limit 50)
exports.getMyOrders = async (req, res) => {
  try {
    const vendorId = req.vendor?.id || req.query.vendorId || req.params.vendorId;
    if (!vendorId) return res.status(400).json({ message: "Missing vendorId" });

    const orders = await Order.findAll({
      where: { VendorId: vendorId },
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        {
          model: OrderItem,
          include: [{ model: MenuItem, attributes: ["id", "name", "price"] }],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: 50,
    });

    res.json(orders);
  } catch (err) {
    console.error("vendors.getMyOrders error:", err);
    res.status(500).json({ message: "Failed to load orders", error: err.message });
  }
};

// GET /api/vendor/ratings/summary → { ratingAvg, ratingCount, lastRatedAt }
exports.getRatingsSummary = async (req, res) => {
  try {
    const vendorId = req.vendor?.id || req.query.vendorId || req.params.vendorId;
    if (!vendorId) return res.status(400).json({ message: "Missing vendorId" });

    const summary = await recomputeVendorRatings(vendorId);

    const last = await Order.findOne({
      where: { VendorId: vendorId, rating: { [Op.ne]: null } },
      order: [["updatedAt", "DESC"]],
      attributes: ["updatedAt"],
      raw: true,
    });

    res.json({
      ...summary,
      lastRatedAt: last?.updatedAt || null,
    });
  } catch (err) {
    console.error("vendors.getRatingsSummary error:", err);
    res.status(500).json({ message: "Failed to load ratings summary" });
  }
};

/* ------------------------------------------------------------------ */
/* Expose helpers so other controllers (e.g., rate-order) can use them */
/* ------------------------------------------------------------------ */
exports.recomputeVendorRatings = recomputeVendorRatings;