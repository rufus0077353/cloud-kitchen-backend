
// models/index.js
const path = require("path");
const fs = require("fs");
const Sequelize = require("sequelize");
const sequelize = require("../config/db");

const db = {};
db.Sequelize = Sequelize;
db.sequelize = sequelize;

/* ------------------ robust model loader ------------------ */
/** Try to load a model from several case/variant filenames. */
function loadModel(name, variants = []) {
  const tried = [];
  const candidates = [name, ...variants].map(n => `./${n}`);
  for (const rel of candidates) {
    try {
      const mod = require(rel); // case-sensitive on Linux
      if (typeof mod === "function") {
        const m = mod(sequelize, Sequelize.DataTypes);
        console.log(`[models] Loaded ${name} from ${rel}`);
        return m;
      } else {
        console.warn(`[models] ${rel} did not export a factory function — skipped`);
      }
    } catch (e) {
      tried.push(`${rel} (${e.code || e.message})`);
    }
  }
  console.warn(`[models] Skipping ${name}: could not load any of -> ${tried.join(", ")}`);
  return null;
}

/* Optional: print what's in /models at runtime to spot casing issues */
try {
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith(".js"));
  console.log("[models] Files present:", files.join(", "));
} catch {}

/* ------------------ load models ------------------ */
db.User          = loadModel("User");
db.Vendor        = loadModel("Vendor");
db.MenuItem      = loadModel("MenuItem");
db.Order         = loadModel("Order");
db.OrderItem     = loadModel("OrderItem");

// Try common variants in case the file got named differently.
// The FIRST match wins; still best to keep it exactly "Payout.js".
db.Payout        = loadModel("Payout", ["payout", "Payouts", "payouts"]);
db.PayoutLog     = loadModel("PayoutLog", ["payoutlog", "Payoutlogs", "payoutlogs"]);


db.EmailConfirmToken = loadModel("EmailConfirmToken");
db.OtpToken         = loadModel("OtpToken");

// Optional
db.PushSubscription = loadModel("PushSubscription");

/* ------------------ associations (guarded) ------------------ */
// User ↔ Vendor (1:1)
if (db.User && db.Vendor) {
  db.User.hasOne(db.Vendor, { foreignKey: "UserId", onDelete: "CASCADE" });
  db.Vendor.belongsTo(db.User, { foreignKey: "UserId" });
}

// Vendor ↔ MenuItem (1:M)
if (db.Vendor && db.MenuItem) {
  db.Vendor.hasMany(db.MenuItem, { foreignKey: "VendorId", onDelete: "CASCADE" });
  db.MenuItem.belongsTo(db.Vendor, { foreignKey: "VendorId" });
}

// User ↔ Order (1:M)
if (db.User && db.Order) {
  db.User.hasMany(db.Order, { foreignKey: "UserId", onDelete: "CASCADE" });
  db.Order.belongsTo(db.User, { foreignKey: "UserId" });
}

// Vendor ↔ Order (1:M)
if (db.Vendor && db.Order) {
  db.Vendor.hasMany(db.Order, { foreignKey: "VendorId", onDelete: "CASCADE" });
  db.Order.belongsTo(db.Vendor, { foreignKey: "VendorId" });
}

// Order ↔ OrderItem (1:M)
if (db.Order && db.OrderItem) {
  db.Order.hasMany(db.OrderItem, { foreignKey: "OrderId", onDelete: "CASCADE" });
  db.OrderItem.belongsTo(db.Order, { foreignKey: "OrderId" });
}

// MenuItem ↔ OrderItem (1:M)
if (db.MenuItem && db.OrderItem) {
  db.MenuItem.hasMany(db.OrderItem, { foreignKey: "MenuItemId", onDelete: "CASCADE" });
  db.OrderItem.belongsTo(db.MenuItem, { foreignKey: "MenuItemId" });
}

// User ↔ PushSubscription (1:M) — optional
if (db.User && db.PushSubscription) {
  db.User.hasMany(db.PushSubscription, { foreignKey: "userId", onDelete: "CASCADE" });
  db.PushSubscription.belongsTo(db.User, { foreignKey: "userId" });
}

// Vendor ↔ Payout (1:M)
if (db.Vendor && db.Payout) {
  db.Vendor.hasMany(db.Payout, { foreignKey: "VendorId", onDelete: "CASCADE" });
  db.Payout.belongsTo(db.Vendor, { foreignKey: "VendorId" });
}

if (db.Payout && db.PayoutLog) {
  db.Payout.hasMany(db.PayoutLog, { foreignKey: "PayoutId", onDelete: "CASCADE" });
  db.PayoutLog.belongsTo(db.Payout, { foreignKey: "PayoutId" });
}

if (db.Vendor && db.PayoutLog) {
  db.Vendor.hasMany(db.PayoutLog, { foreignKey: "VendorId", onDelete: "CASCADE" });
  db.PayoutLog.belongsTo(db.Vendor, { foreignKey: "VendorId" });
}

// Order ↔ Payout (1:1)
if (db.Order && db.Payout) {
  db.Order.hasOne(db.Payout, { foreignKey: "OrderId", onDelete: "SET NULL" });
  db.Payout.belongsTo(db.Order, { foreignKey: "OrderId" });
}

// Convenience M:N: Order ↔ MenuItem via OrderItem
if (db.Order && db.MenuItem && db.OrderItem) {
  db.Order.belongsToMany(db.MenuItem, {
    through: db.OrderItem,
    foreignKey: "OrderId",
    otherKey: "MenuItemId",
  });
  db.MenuItem.belongsToMany(db.Order, {
    through: db.OrderItem,
    foreignKey: "MenuItemId",
    otherKey: "OrderId",
  });
}

module.exports = db;