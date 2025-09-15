
// controllers/vendorController.js
const { Vendor, User, Sequelize } = require("../models");

/* ----------------------- helpers ----------------------- */
function parseCommissionRate(input) {
  if (input === undefined || input === null || input === "") return undefined;

  let n = Number(input);
  if (!Number.isFinite(n)) return undefined;

  // If someone accidentally sends 20 (percent), treat as 0.20
  if (n > 1 && n <= 100) n = n / 100;

  // Clamp to [0, 1]
  if (n < 0) n = 0;
  if (n > 1) n = 1;

  return n;
}

function pickUpdatableFields(src) {
  // Only include keys that were actually provided
  const dst = {};
  const keys = ["name", "location", "cuisine", "UserId", "isOpen", "isDeleted"];
  keys.forEach((k) => {
    if (src[k] !== undefined) dst[k] = src[k];
  });

  // commissionRate is special (don’t overwrite unless provided)
  const cr = parseCommissionRate(src.commissionRate);
  if (cr !== undefined) dst.commissionRate = cr;

  return dst;
}

/* ----------------------- list vendors ----------------------- */
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

    // Return shape compatible with your dashboard's fallback logic
    return res.json({
      items: rows,
      total: count,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("vendors.list error:", err);
    return res.status(500).json({ message: "Failed to load vendors" });
  }
};

/* ----------------------- get one ----------------------- */
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

/* ----------------------- create ----------------------- */
// POST /api/vendors
// body: { name, location, cuisine, UserId, commissionRate? (decimal or percent), isOpen? }
exports.create = async (req, res) => {
  try {
    const { name, location, cuisine, UserId } = req.body;
    if (!name || !location || !cuisine || !UserId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const data = {
      name,
      location,
      cuisine,
      UserId,
    };

    // Optional fields
    if (req.body.isOpen !== undefined) data.isOpen = !!req.body.isOpen;

    const cr = parseCommissionRate(req.body.commissionRate);
    if (cr !== undefined) data.commissionRate = cr; // do not set otherwise (model default will apply)

    const created = await Vendor.create(data);
    return res.status(201).json(created);
  } catch (err) {
    console.error("vendors.create error:", err);
    return res.status(500).json({ message: "Failed to create vendor" });
  }
};

/* ----------------------- update ----------------------- */
// PUT /api/vendors/:id
// body: any of { name, location, cuisine, UserId, isOpen, isDeleted, commissionRate }
exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const v = await Vendor.findByPk(id);
    if (!v) return res.status(404).json({ message: "Vendor not found" });

    const { name, location, cuisine, UserId, isOpen, commissionRate } = req.body;

    if (name !== undefined) v.name = name;
    if (location !== undefined) v.location = location;
    if (cuisine !== undefined) v.cuisine = cuisine;
    if (UserId !== undefined) v.UserId = UserId;
    if (isOpen !== undefined) v.isOpen = !!isOpen;

    // IMPORTANT: only set when explicitly provided; allow null to mean “use default”
    if (commissionRate !== undefined) {
      v.commissionRate =
        commissionRate === null || commissionRate === ""
          ? null
          : Number(commissionRate);
    }

    await v.save();
    res.json(v);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update vendor" });
  }
};

/* ----------------------- delete (hard) ----------------------- */
// DELETE /api/vendors/:id
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