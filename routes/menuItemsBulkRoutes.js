
const express = require("express");
const multer = require("multer");
const { parse } = require("csv-parse");
const { MenuItem, Vendor } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Helpers
function norm(s) { return String(s ?? "").trim(); }
function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toBool(v, def = true) {
  if (v === null || v === undefined || v === "") return def;
  const s = String(v).trim().toLowerCase();
  if (["1","true","yes","y"].includes(s)) return true;
  if (["0","false","no","n"].includes(s)) return false;
  return def;
}

// --------------- Template -----------------
router.get("/template-csv", authenticateToken, requireVendor, async (_req, res) => {
  const header = ["name", "price", "description", "imageUrl", "isAvailable"];
  const sample = [
    ["Margherita Pizza", "199", "Classic cheese pizza", "https://.../marg.jpg", "true"],
    ["Paneer Tikka",    "249", "Cottage cheese tikka", "https://.../paneer.jpg", "true"]
  ];
  let csv = header.join(",") + "\n";
  for (const row of sample) {
    const line = row.map(v => {
      const val = String(v ?? "").replace(/"/g, '""');
      return /[",\n]/.test(val) ? `"${val}"` : val;
    }).join(",");
    csv += line + "\n";
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="menu-template.csv"');
  return res.send(csv);
});

// --------------- Bulk CSV (create or upsert by name within vendor) ---------------
router.post("/bulk-csv", authenticateToken, requireVendor, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "CSV file is required (field name: file)" });

    // Determine vendorId from token (you already attach it)
    const vendorId = Number(req.user?.vendorId);
    if (!Number.isFinite(vendorId)) {
      return res.status(403).json({ message: "No vendor linked to this account" });
    }

    // Light vendor existence check (paranoid-safe)
    const ownedVendor = await Vendor.findOne({ where: { id: vendorId } });
    if (!ownedVendor) return res.status(404).json({ message: "Vendor not found" });

    const mode = (req.body.mode || "upsert").toLowerCase(); // "create" | "upsert"
    const createOnly = mode === "create";

    // Parse CSV
    const records = await new Promise((resolve, reject) => {
      parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true }, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
    if (!records.length) return res.status(400).json({ message: "CSV seems empty" });

    // Prepare result
    const result = { total: records.length, created: 0, updated: 0, skipped: 0, errors: [] };

    // Preload existing items by name (within vendor) to minimize queries
    const existing = await MenuItem.findAll({
      where: { VendorId: vendorId },
      attributes: ["id", "name"]
    });
    const byName = new Map(existing.map(x => [x.name.toLowerCase(), x]));

    const t = await MenuItem.sequelize.transaction();

    try {
      for (let i = 0; i < records.length; i++) {
        const raw = records[i];

        // map flexible keys
        const name = norm(raw.name || raw.item || raw.title);
        const price = toNum(raw.price || raw.amount || raw.mrp);
        const description = norm(raw.description || raw.desc || raw.about || "");
        const imageUrl = norm(raw.imageUrl || raw.image || raw.img || "");
        const isAvailable = toBool(raw.isAvailable ?? raw.available ?? raw.active, true);

        // basic validation
        if (!name || price == null) {
          result.skipped++;
          result.errors.push({ row: i + 2, reason: "Missing required fields: name and price" });
          continue;
        }
        if (price < 0) {
          result.skipped++;
          result.errors.push({ row: i + 2, reason: "Price cannot be negative" });
          continue;
        }

        const key = name.toLowerCase();
        const ex = byName.get(key);

        if (ex) {
          if (createOnly) {
            result.skipped++;
            continue;
          }
          await MenuItem.update(
            {
              // keep name as-is (keyed by name)
              price,
              description: description || null,
              imageUrl: imageUrl || null,
              isAvailable
            },
            { where: { id: ex.id }, transaction: t }
          );
          result.updated++;
        } else {
          const created = await MenuItem.create(
            {
              VendorId: vendorId,
              name,
              price,
              description: description || null,
              imageUrl: imageUrl || null,
              isAvailable
            },
            { transaction: t }
          );
          byName.set(key, created); // so subsequent rows with same name update
          result.created++;
        }
      }

      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }

    return res.json(result);
  } catch (e) {
    console.error("POST /api/menu-items/bulk-csv error:", e);
    return res.status(500).json({ message: "Bulk upload failed", error: e.message });
  }
});

module.exports = router;