// routes/vendor.routes.js
const express = require("express");
const router = express.Router();
const { Op, Sequelize } = require("sequelize");
const db = require("../models");
const { Vendor, MenuItem, Order, OrderItem, Payout, User } = db;
const {
  authenticateToken,
  requireVendor,
  requireAdmin,
} = require("../middleware/authMiddleware");

/* ------------------------------------------------------------------ */
/* Helpers: safe attributes & vendor lookup                            */
/* ------------------------------------------------------------------ */

// Only return columns that exist in the current DB schema.
const vendorCols = Object.keys(Vendor?.rawAttributes || {});
const pickAttrs = (list) => list.filter((c) => vendorCols.includes(c));

const BASE_VENDOR_ATTRS = [
  "id",
  "UserId",
  "isOpen",
  "name",
  "location",
  "cuisine",
  "phone",
  "imageUrl",       // optional in schema — filtered by pickAttrs()
  "description",    // optional
  "etaMins",        // optional
  "deliveryFee",    // optional
  "commissionRate", // optional
  "ratingAvg",      // optional
  "ratingCount",    // optional
  "isDeleted",
  "createdAt",
  "updatedAt",
];

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
  return v;
}

/** All vendor ids owned by a user. */
async function allVendorIdsForUser(userId) {
  const rows = await Vendor.findAll({
    where: { UserId: userId },
    attributes: ["id"],
  });
  return rows.map((r) => Number(r.id)).filter(Number.isFinite);
}

/** Recompute and persist vendor rating aggregates from Orders.rating. */
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

  await Vendor.update({ ratingCount, ratingAvg }, { where: { id: vendorId } });
  return { ratingCount, ratingAvg };
}

/* =========================== WHO AM I ============================ */
router.get("/me", authenticateToken, requireVendor, async (req, res) => {
  try {
    const v = await getOrCreateVendorForUser(req.user.id);
    if (!v) return res.status(404).json({ message: "Vendor profile not found" });

    const safe = {};
    for (const k of pickAttrs(BASE_VENDOR_ATTRS)) safe[k] = v[k];

    res.json({ vendorId: v.id, userId: req.user.id, ...safe });
  } catch (e) {
    res
      .status(500)
      .json({ message: "Failed to load vendor profile", error: e.message });
  }
});

// --- Ratings histogram & recent reviews for the logged-in vendor ---
// GET /api/vendors/me/ratings/histogram
router.get("/me/ratings/histogram", authenticateToken, requireVendor, async (req, res) => {
  try {
    const v = await getOrCreateVendorForUser(req.user.id);
    if (!v) return res.status(404).json({ message: "Vendor not found" });

    // bucketize 1..5 stars (integers). If you allow half-stars, floor them.
    const rows = await Order.findAll({
      where: { VendorId: v.id, rating: { [Op.ne]: null } },
      attributes: ["rating"],
      raw: true,
    });

    const buckets = { 1:0, 2:0, 3:0, 4:0, 5:0 };
    for (const r of rows) {
      const star = Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0)));
      buckets[star] = (buckets[star] || 0) + 1;
    }
    const total = rows.length || 0;
    const avg = total ? (rows.reduce((s, r) => s + Number(r.rating || 0), 0) / total) : 0;

    return res.json({
      vendorId: v.id,
      total,
      avg: Number(avg.toFixed(2)),
      histogram: buckets, // {1: n, 2: n, 3: n, 4: n, 5: n}
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load rating histogram", error: err.message });
  }
});


// GET /api/vendors/me/reviews?limit=20

// helpers
const pickExistingField = (model, candidates = []) => {
  const attrs = model?.rawAttributes ? Object.keys(model.rawAttributes) : [];
  return candidates.find((c) => attrs.includes(c)) || null;
};

router.get("/me/reviews", authenticateToken, requireVendor, async (req, res) => {
  try {
    // Vendors owned by this user (handles multi-vendor accounts)
    const myVendors = await Vendor.findAll({ where: { UserId: req.user.id }, attributes: ["id"] });
    const vendorIds = myVendors.map(v => Number(v.id)).filter(Number.isFinite);
    if (!vendorIds.length) return res.status(404).json({ message: "Vendor not found" });

    const limit = Math.max(parseInt(req.query.limit || "20", 10), 1);

    // Detect fields on Order
    const orderRatingField = pickExistingField(Order, ["rating", "ratings", "stars", "star", "score"]);
    const orderReviewField = pickExistingField(Order, ["review", "comment", "feedback", "text"]);
    const orderReplyField  = pickExistingField(Order, ["reviewReply", "vendorReply", "reply"]);
    const hasReviewedAt    = !!(Order?.rawAttributes && Order.rawAttributes.reviewedAt);

    let items = [];

    // Try reviews on Order
    if (orderRatingField || orderReviewField) {
      const whereOrder = {
        VendorId: { [Op.in]: vendorIds },
        [Op.or]: [
          ...(orderRatingField ? [{ [orderRatingField]: { [Op.ne]: null } }] : []),
          ...(orderReviewField ? [{ [orderReviewField]: { [Op.ne]: null } }] : []),
        ],
      };

      const orderAttrs = [
        "id", "createdAt", "updatedAt",
        ...(hasReviewedAt ? ["reviewedAt"] : []),
        ...(orderRatingField ? [orderRatingField] : []),
        ...(orderReviewField ? [orderReviewField] : []),
        ...(orderReplyField ? [orderReplyField] : []),
      ];

      // Build safe ORDER BY (no reviewedAt if column doesn’t exist)
      const orderExpr = hasReviewedAt
        ? `COALESCE("Order"."reviewedAt","Order"."updatedAt","Order"."createdAt")`
        : `COALESCE("Order"."updatedAt","Order"."createdAt")`;

      const fromOrders = await Order.findAll({
        where: whereOrder,
        include: [{ model: User, attributes: ["id", "name", "email"] }],
        attributes: orderAttrs,
        order: [[db.sequelize.literal(orderExpr), "DESC"]],
        limit,
      });

      items = (fromOrders || []).map((o) => {
        const ratingVal = orderRatingField ? o[orderRatingField] : null;
        const reviewVal = orderReviewField ? o[orderReviewField] : null;
        const replyVal  = orderReplyField  ? o[orderReplyField]  : null;
        return {
          source: "order",
          orderId: o.id,
          rating: ratingVal != null ? Number(ratingVal) : null,
          review: reviewVal ?? null,
          reply:  replyVal  ?? null,
          reviewedAt: hasReviewedAt ? (o.reviewedAt || o.updatedAt || o.createdAt) : (o.updatedAt || o.createdAt),
          user: o.User ? { id: o.User.id, name: o.User.name, email: o.User.email } : null,
        };
      });
    }

    // Fallback to per-item reviews on OrderItem if nothing found on Order
    if (!items.length) {
      const oiRatingField = pickExistingField(OrderItem, ["rating", "ratings", "stars", "star", "score"]);
      const oiReviewField = pickExistingField(OrderItem, ["review", "comment", "feedback", "text"]);

      if (oiRatingField || oiReviewField) {
        const orders = await Order.findAll({
          where: { VendorId: { [Op.in]: vendorIds } },
          include: [
            { model: User, attributes: ["id", "name", "email"] },
            {
              model: OrderItem,
              required: true,
              where: {
                [Op.or]: [
                  ...(oiRatingField ? [{ [oiRatingField]: { [Op.ne]: null } }] : []),
                  ...(oiReviewField ? [{ [oiReviewField]: { [Op.ne]: null } }] : []),
                ],
              },
              include: [{ model: MenuItem, attributes: ["id", "name"] }],
              attributes: [
                "id", "createdAt", "updatedAt",
                ...(oiRatingField ? [oiRatingField] : []),
                ...(oiReviewField ? [oiReviewField] : []),
              ],
            },
          ],
          order: [["updatedAt", "DESC"]],
          limit,
        });

        const flat = [];
        for (const o of orders) {
          const when = o.updatedAt || o.createdAt;
          const baseUser = o.User ? { id: o.User.id, name: o.User.name, email: o.User.email } : null;
          for (const it of (o.OrderItems || [])) {
            const rVal = oiRatingField ? it[oiRatingField] : null;
            const tVal = oiReviewField ? it[oiReviewField] : null;
            if (rVal == null && (tVal == null || tVal === "")) continue;
            flat.push({
              source: "orderItem",
              orderId: o.id,
              orderItemId: it.id,
              item: it.MenuItem ? { id: it.MenuItem.id, name: it.MenuItem.name } : null,
              rating: rVal != null ? Number(rVal) : null,
              review: tVal ?? null,
              reply: null,
              reviewedAt: when,
              user: baseUser,
            });
          }
        }
        flat.sort((a, b) => new Date(b.reviewedAt) - new Date(a.reviewedAt));
        items = flat.slice(0, limit);
      }
    }

    return res.json({ vendorIds, items });
  } catch (err) {
    console.error("❌ /me/reviews error:", err);
    return res.status(200).json({ vendorIds: [], items: [], _warning: err.message || "unknown" });
  }
});

// GET /api/vendors/me/reviews/debug
router.get("/me/reviews/debug", authenticateToken, requireVendor, async (req, res) => {
  try {
    const v = await getOrCreateVendorForUser(req.user.id);
    if (!v) return res.status(404).json({ ok: false, message: "Vendor not found" });

    const ordersWithRating = await Order.count({ where: { VendorId: v.id, rating: { [Op.ne]: null } } });
    const ordersWithReview = await Order.count({ where: { VendorId: v.id, review: { [Op.ne]: null } } });

    const hasItemRating = !!OrderItem?.rawAttributes?.rating;
    const hasItemReview = !!OrderItem?.rawAttributes?.review;

    let itemsWithRating = 0, itemsWithReview = 0;
    if (hasItemRating) {
      itemsWithRating = await OrderItem.count({
        include: [{ model: Order, required: true, where: { VendorId: v.id } }],
        where: { rating: { [Op.ne]: null } },
      });
    }
    if (hasItemReview) {
      itemsWithReview = await OrderItem.count({
        include: [{ model: Order, required: true, where: { VendorId: v.id } }],
        where: { review: { [Op.ne]: null } },
      });
    }

    return res.json({
      vendorId: v.id,
      ordersLayer: { withRating: ordersWithRating, withReview: ordersWithReview },
      orderItemsLayer: { hasItemRating, hasItemReview, itemsWithRating, itemsWithReview },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});


// Helper: ensure Orders table has a reply column; add one on-the-fly in dev if missing
async function ensureOrdersReplyColumn() {
  try {
    const qi = db.sequelize.getQueryInterface();
    const desc = await qi.describeTable("Orders");
    // use first existing or create "reviewReply"
    if (!desc.reviewReply && !desc.vendorReply && !desc.reply) {
      await qi.addColumn("Orders", "reviewReply", { type: Sequelize.TEXT, allowNull: true });
    }
    return true;
  } catch {
    // swallow — we’ll still try to set whichever exists
    return false;
  }
}

// POST /api/vendors/me/reviews/:orderId/reply { text }
router.post(
  "/me/reviews/:orderId/reply",
  authenticateToken,
  requireVendor,
  async (req, res) => {
    try {
      const v = await getOrCreateVendorForUser(req.user.id);
      if (!v) return res.status(404).json({ message: "Vendor not found" });

      const orderId = Number(req.params.orderId);
      if (!Number.isFinite(orderId)) return res.status(400).json({ message: "Invalid order id" });

      const text = String(req.body?.text || "").trim();
      if (!text) return res.status(400).json({ message: "Reply text is required" });

      const order = await Order.findOne({ where: { id: orderId, VendorId: v.id } });
      if (!order) return res.status(404).json({ message: "Order not found for this vendor" });
      if (order.rating == null && !order.review) {
        return res.status(400).json({ message: "Cannot reply: this order has no review/rating" });
      }

      // try to ensure a reply column exists (creates Orders.reviewReply if none)
      await ensureOrdersReplyColumn();

      // set whichever field exists in your model mapping
      if ("reviewReply" in Order.rawAttributes) {
        order.set("reviewReply", text);
      } else if ("vendorReply" in Order.rawAttributes) {
        order.set("vendorReply", text);
      } else if ("reply" in Order.rawAttributes) {
        order.set("reply", text);
      } else {
        // As a last resort, keep it safe and fail rather than damaging user review text
        return res.status(409).json({
          message:
            "No reply column found on Orders. Please add a TEXT column named `reviewReply` (recommended)."
        });
      }

      await order.save();

      // notify vendor dashboard sockets (optional)
      const io = req.app.get("io");
      if (io) io.to(`vendor:${v.id}`).emit("review:reply", { orderId, reply: text });

      return res.json({ ok: true, orderId, reply: text });
    } catch (err) {
      return res.status(500).json({ message: "Failed to save reply", error: err.message });
    }
  }
);

/* ============== TOGGLE OPEN/CLOSED ============== */
router.patch("/me/open", authenticateToken, requireVendor, async (req, res) => {
  try {
    const { isOpen } = req.body;
    if (typeof isOpen !== "boolean") {
      return res.status(400).json({ message: "isOpen must be boolean" });
    }
    const v = await getOrCreateVendorForUser(req.user.id);
    if (!v || v.isDeleted)
      return res.status(404).json({ message: "Vendor not found" });

    v.isOpen = isOpen;
    await v.save();

    const io = req.app.get("io");
    if (io) io.emit("vendor:status", { vendorId: v.id, isOpen: v.isOpen });
    res.json({ message: "Vendor status updated", vendor: v });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to update vendor status", error: err.message });
  }
});

/* ====================== DASHBOARD: ORDERS ======================== */
// GET /api/vendors/me/orders?limit=50
router.get(
  "/me/orders",
  authenticateToken,
  requireVendor,
  async (req, res) => {
    try {
      const v = await getOrCreateVendorForUser(req.user.id);
      if (!v) return res.status(404).json({ message: "Vendor not found" });

      const limit = Math.max(parseInt(req.query.limit || "50", 10), 1);

      const orders = await Order.findAll({
        where: { VendorId: v.id },
        include: [
          { model: User, attributes: ["id", "name", "email"] },
          {
            model: OrderItem,
            include: [{ model: MenuItem, attributes: ["id", "name", "price"] }],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit,
      });

      res.json(orders);
    } catch (err) {
      res
        .status(500)
        .json({ message: "Failed to load vendor orders", error: err.message });
    }
  }
);

/* =================== DASHBOARD: RATINGS SUMMARY ================== */
// GET /api/vendors/me/ratings
router.get(
  "/me/ratings",
  authenticateToken,
  requireVendor,
  async (req, res) => {
    try {
      const v = await getOrCreateVendorForUser(req.user.id);
      if (!v) return res.status(404).json({ message: "Vendor not found" });

      const summary = await recomputeVendorRatings(v.id);
      const last = await Order.findOne({
        where: { VendorId: v.id, rating: { [Op.ne]: null } },
        order: [["updatedAt", "DESC"]],
        attributes: ["updatedAt"],
        raw: true,
      });

      res.json({ vendorId: v.id, ...summary, lastRatedAt: last?.updatedAt || null });
    } catch (err) {
      res
        .status(500)
        .json({ message: "Failed to load ratings summary", error: err.message });
    }
  }
);

// POST /api/vendors/:id/ratings/recompute  (admin or owner)
router.post(
  "/:id/ratings/recompute",
  authenticateToken,
  requireVendor,
  async (req, res) => {
    try {
      const idNum = Number(req.params.id);
      if (!Number.isFinite(idNum))
        return res.status(400).json({ message: "Invalid vendor id" });

      // allow only owner (or admin via your middleware if you prefer)
      const myIds = await allVendorIdsForUser(req.user.id);
      if (!myIds.includes(idNum) && req.user.role !== "admin") {
        return res.status(403).json({ message: "Not your vendor" });
      }

      const summary = await recomputeVendorRatings(idNum);
      res.json({ vendorId: idNum, ...summary });
    } catch (err) {
      res
        .status(500)
        .json({ message: "Failed to recompute ratings", error: err.message });
    }
  }
);

/* ======================== PUBLIC: LIST ALL ======================= */
router.get("/", async (_req, res) => {
  try {
    const vendors = await Vendor.findAll({
      where: { isDeleted: { [Op.not]: true } },
      attributes: pickAttrs(
        BASE_VENDOR_ATTRS.filter((k) => k !== "UserId" && k !== "isDeleted")
      ),
      order: [["createdAt", "DESC"]],
    });
    res.json(vendors);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching vendors", error: err.message });
  }
});

/* =================== CREATE / REUSE (IDEMPOTENT) ================= */
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { name, location, cuisine, UserId, phone, imageUrl } = req.body;
    if (!name || !location || !cuisine) {
      return res
        .status(400)
        .json({ message: "Name, location, and cuisine are required" });
    }
    const userId = UserId || req.user.id;

    let vendor = await Vendor.findOne({
      where: { UserId: userId },
      attributes: pickAttrs(BASE_VENDOR_ATTRS),
    });

    if (!vendor) {
      vendor = await Vendor.create({
        UserId: userId,
        name,
        location,
        cuisine,
        isOpen: true,
        phone: phone || null,
        imageUrl: imageUrl || null,
        isDeleted: false,
      });
      return res
        .status(201)
        .json({ message: "Vendor created", vendor, created: true });
    }

    if (vendor.isDeleted) vendor.isDeleted = false;
    vendor.name = name ?? vendor.name;
    vendor.location = location ?? vendor.location;
    vendor.cuisine = cuisine ?? vendor.cuisine;
    vendor.phone = phone ?? vendor.phone;
    if (vendorCols.includes("imageUrl"))
      vendor.imageUrl = imageUrl ?? vendor.imageUrl;

    await vendor.save();
    res
      .status(200)
      .json({ message: "Vendor reused", vendor, created: false });
  } catch (err) {
    res.status(500).json({
      message: "Error creating/reusing vendor",
      error: err.message,
    });
  }
});

/* ======================= PUBLIC: MENU BY VENDOR ================== */
router.get("/:id/menu", async (req, res) => {
  try {
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum))
      return res.status(400).json({ message: "Invalid vendor id" });

    const vendor = await Vendor.findByPk(idNum, {
      attributes: pickAttrs(["id", "isOpen", "isDeleted"]),
    });
    if (!vendor || vendor.isDeleted)
      return res.status(404).json({ message: "Vendor not found" });

    const items = await MenuItem.findAll({
      where: { VendorId: idNum, isAvailable: true },
      order: [["createdAt", "DESC"]],
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch vendor menu",
      error: err.message,
    });
  }
});

/* ======================= PUBLIC: GET VENDOR BY ID ================= */
router.get("/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findOne({
      where: { id: req.params.id, isDeleted: { [Op.not]: true } },
      attributes: pickAttrs(
        BASE_VENDOR_ATTRS.filter((k) => k !== "UserId" && k !== "isDeleted")
      ),
    });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    res.json(vendor);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching vendor", error: err.message });
  }
});

/* =========================== UPDATE VENDOR ======================= */
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { name, cuisine, location, isOpen, phone, imageUrl } = req.body;
    const vendor = await Vendor.findByPk(req.params.id, {
      attributes: pickAttrs(BASE_VENDOR_ATTRS),
    });
    if (!vendor || vendor.isDeleted)
      return res.status(404).json({ message: "Vendor not found" });

    vendor.name = name ?? vendor.name;
    vendor.cuisine = cuisine ?? vendor.cuisine;
    vendor.location = location ?? vendor.location;
    vendor.phone = phone ?? vendor.phone;
    if (vendorCols.includes("imageUrl"))
      vendor.imageUrl = imageUrl ?? vendor.imageUrl;
    if (typeof isOpen === "boolean") vendor.isOpen = isOpen;

    await vendor.save();

    if (typeof isOpen === "boolean") {
      const io = req.app.get("io");
      if (io) io.emit("vendor:status", { vendorId: vendor.id, isOpen: vendor.isOpen });
    }

    res.json({ message: "Vendor updated", vendor });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error updating vendor", error: err.message });
  }
});

/* ========================== SOFT DELETE (ADMIN) ================== */
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum))
      return res.status(400).json({ message: "Invalid id" });

    const vendor = await Vendor.findByPk(idNum);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    vendor.isDeleted = true;
    await vendor.save();

    res.json({ message: "Vendor soft-deleted", vendorId: idNum });
  } catch (e) {
    res.status(500).json({ message: "Soft delete failed", error: e.message });
  }
});

/* ====================== HARD DELETE + CASCADE (ADMIN) ============ */
router.delete(
  "/:id/force",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const t = await Vendor.sequelize.transaction();
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        await t.rollback();
        return res.status(400).json({ message: "Invalid id" });
      }

      const v = await Vendor.findByPk(id, { transaction: t });
      if (!v) {
        await t.rollback();
        return res.status(404).json({ message: "Vendor not found" });
      }

      const orders = await Order.findAll({
        where: { VendorId: id },
        attributes: ["id"],
        transaction: t,
      });
      const orderIds = orders.map((o) => o.id);

      let deletedOrderItems = 0;
      if (orderIds.length) {
        deletedOrderItems = await OrderItem.destroy({
          where: { OrderId: { [Op.in]: orderIds } },
          transaction: t,
        });
      }

      const deletedOrders = await Order.destroy({
        where: { VendorId: id },
        transaction: t,
      });

      let deletedPayouts = 0;
      if (Payout && typeof Payout.destroy === "function") {
        deletedPayouts = await Payout.destroy({
          where: { VendorId: id },
          transaction: t,
        });
      }

      const deletedMenuItems = await MenuItem.destroy({
        where: { VendorId: id },
        transaction: t,
      });

      await Vendor.destroy({ where: { id }, transaction: t });

      await t.commit();
      res.json({
        message: "Vendor and related data deleted",
        counts: {
          orders: deletedOrders,
          orderItems: deletedOrderItems,
          menuItems: deletedMenuItems,
          payouts: deletedPayouts,
        },
      });
    } catch (e) {
      try {
        await t.rollback();
      } catch {}
      res.status(500).json({ message: "Force delete failed", error: e.message });
    }
  }
);

/* ======================== PAYOUTS SUMMARY ======================== */
// Returns: { vendorId, paidOrders, grossPaid, commission, netOwed }

// GET /api/vendors/:id/payouts?from=2025-10-01&to=2025-10-31
router.get("/:id/payouts", authenticateToken, requireVendor, async (req, res) => {
  const t = await Vendor.sequelize.transaction();
  try {
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum)) {
      await t.rollback();
      return res.status(400).json({ message: "Invalid vendor id" });
    }

    // ---- Ownership check (this authed user must own this vendor)
    const myIds = (
      await Vendor.findAll({
        where: { UserId: req.user.id },
        attributes: ["id"],
        transaction: t,
      })
    ).map(v => Number(v.id));

    if (!myIds.includes(idNum)) {
      await t.rollback();
      return res.status(403).json({ message: "Not your vendor" });
    }

    // ---- Date range (optional)
    const { from, to } = req.query || {};
    const rangeWhere = {};
    if (from || to) {
      rangeWhere.createdAt = {};
      if (from) rangeWhere.createdAt[Op.gte] = new Date(from);
      if (to)   rangeWhere.createdAt[Op.lte] = new Date(to);
    }

    // =========================
    // 1) Try from Payouts (preferred)
    // =========================
    let usedSource = "payouts";
    let result = {
      vendorId: idNum,
      range: { from: from || null, to: to || null },
      paidOrders: 0,
      grossPaid: 0,
      commission: 0,
      netOwed: 0,
      payouts: {  // breakdown from Payouts table
        pendingCount: 0,
        pendingTotal: 0,
        paidCount: 0,
        paidTotal: 0,
      },
      source: "payouts",
    };

    const hasPayoutModel =
      !!Payout && typeof Payout.findAll === "function" && Payout.sequelize;

    if (hasPayoutModel) {
      const rows = await Payout.findAll({
        where: { VendorId: idNum, ...rangeWhere },
        attributes: [
          "status",
          [Vendor.sequelize.fn("COUNT", Vendor.sequelize.col("id")), "count"],
          [Vendor.sequelize.fn("SUM", Vendor.sequelize.col("grossAmount")), "gross"],
          [Vendor.sequelize.fn("SUM", Vendor.sequelize.col("commissionAmount")), "commission"],
          [Vendor.sequelize.fn("SUM", Vendor.sequelize.col("payoutAmount")), "payout"],
        ],
        group: ["status"],
        transaction: t,
        raw: true,
      });

      let grossPaid = 0, commission = 0, net = 0, paidOrders = 0;
      let pendingCount = 0, pendingTotal = 0, paidCount = 0, paidTotal = 0;

      for (const r of rows) {
        const st = String(r.status || "").toLowerCase();
        const g = Number(r.gross || 0);
        const c = Number(r.commission || 0);
        const p = Number(r.payout || 0);
        const cnt = Number(r.count || 0);

        if (st === "paid" || st === "completed" || st === "settled") {
          paidOrders += cnt;
          grossPaid += g;
          commission += c;
          net += p;
          paidCount += cnt;
          paidTotal += p;
        } else if (st === "pending" || st === "queued") {
          pendingCount += cnt;
          pendingTotal += p;
        } else {
          // treat unknown statuses as pending for safety
          pendingCount += cnt;
          pendingTotal += p;
        }
      }

      if ((rows && rows.length) || paidOrders > 0 || pendingCount > 0) {
        await t.commit();
        return res.json({
          ...result,
          paidOrders,
          grossPaid: +grossPaid.toFixed(2),
          commission: +commission.toFixed(2),
          netOwed: +net.toFixed(2),
          payouts: {
            pendingCount,
            pendingTotal: +pendingTotal.toFixed(2),
            paidCount,
            paidTotal: +paidTotal.toFixed(2),
          },
          source: "payouts",
        });
      }
      // else fall back to Orders computation below
      usedSource = "orders-fallback";
    } else {
      usedSource = "orders-fallback";
    }

    // =========================
    // 2) Fallback: compute from Orders + OrderItems
    // =========================
    const DONE = ["delivered", "completed", "paid"];

    const orders = await Order.findAll({
      where: { VendorId: idNum, ...rangeWhere },
      include: [
        { model: Vendor, attributes: ["commissionRate"] },
        {
          model: OrderItem,
          required: false,
          include: [{ model: MenuItem, required: false, attributes: ["id", "price"] }],
        },
      ],
      transaction: t,
    });

    let paidOrders = 0;
    let grossPaid = 0;
    let commission = 0;

    for (const o of orders) {
      const hasStatus = Object.prototype.hasOwnProperty.call(o.dataValues, "status");
      const ok = !hasStatus || (o.status && DONE.includes(String(o.status).toLowerCase()));
      if (!ok) continue;

      // line-items sum
      const items = Array.isArray(o.OrderItems) ? o.OrderItems : [];
      let fromLines = 0;
      for (const it of items) {
        const qty = Number(it?.quantity ?? it?.OrderItem?.quantity ?? 0) || 0;
        const price = Number(it?.MenuItem?.price ?? it?.price ?? 0) || 0;
        fromLines += qty * price;
      }

      // order total fallbacks
      let orderAmount = fromLines;
      if (orderAmount === 0 && Object.prototype.hasOwnProperty.call(o.dataValues, "totalAmount")) {
        orderAmount = Number(o.totalAmount || 0);
      }
      if (orderAmount === 0 && Object.prototype.hasOwnProperty.call(o.dataValues, "amount")) {
        orderAmount = Number(o.amount || 0);
      }
      if (orderAmount === 0 && Object.prototype.hasOwnProperty.call(o.dataValues, "total")) {
        orderAmount = Number(o.total || 0);
      }

      grossPaid += orderAmount;
      paidOrders += 1;

      // commission precedence
      const envRate = Number(process.env.COMMISSION_PCT || 0.15);
      const vendorRate = o?.Vendor?.commissionRate != null ? Number(o.Vendor.commissionRate) : null;
      const orderRate = o?.commissionRate != null ? Number(o.commissionRate) : null;
      const rate = Number.isFinite(orderRate)
        ? orderRate
        : Number.isFinite(vendorRate)
          ? vendorRate
          : envRate;

      commission += orderAmount * (Number.isFinite(rate) ? rate : envRate);
    }

    const netOwed = Math.max(0, grossPaid - commission);

    await t.commit();
    return res.json({
      vendorId: idNum,
      range: { from: from || null, to: to || null },
      paidOrders,
      grossPaid: +grossPaid.toFixed(2),
      commission: +commission.toFixed(2),
      netOwed: +netOwed.toFixed(2),
      payouts: { pendingCount: 0, pendingTotal: 0, paidCount: paidOrders, paidTotal: +netOwed.toFixed(2) },
      source: usedSource, // "orders-fallback" if Payouts not used
    });
  } catch (e) {
    try { await t.rollback(); } catch {}
    // Return a safe payload (avoid breaking the dashboard)
    return res.status(200).json({
      vendorId: Number(req.params.id) || null,
      range: { from: req.query?.from || null, to: req.query?.to || null },
      paidOrders: 0,
      grossPaid: 0,
      commission: 0,
      netOwed: 0,
      payouts: { pendingCount: 0, pendingTotal: 0, paidCount: 0, paidTotal: 0 },
      source: "error-fallback",
      _warning: "Payouts summary fallback used: " + (e?.message || "unknown error"),
    });
  }
});

/* ===================== ALIAS: /orders/payouts/summary ===================== */
// Allows frontend (VendorDashboard) to fetch payouts without changing URL
// It automatically finds the vendor linked to the logged-in user
router.get("/me/payouts/summary", authenticateToken, requireVendor, async (req, res) => {
  try {
    const v = await Vendor.findOne({ where: { UserId: req.user.id } });
    if (!v) return res.status(404).json({ message: "Vendor not found for this user" });

    // Internally call the vendor payouts logic for this vendor ID
    const url = `${req.protocol}://${req.get("host")}/api/vendors/${v.id}/payouts`;
    const r = await fetch(url, {
      headers: { Authorization: req.headers.authorization || "" },
    });
    const data = await r.json();

    return res.status(r.status).json(data);
  } catch (err) {
    console.error("me/payouts/summary error:", err);
    return res.status(500).json({
      message: "Failed to load vendor payout summary",
      error: err.message,
    });
  }
});

module.exports = router;