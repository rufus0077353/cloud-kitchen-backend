// models/index.js
const Sequelize = require("sequelize");
const sequelize = require("../config/db");

const db = {};
db.Sequelize = Sequelize;
db.sequelize = sequelize;

/* ------------------ safe model loader ------------------ */
function loadModel(name) {
  try {
    const mod = require(`./${name}`); // ensure file name matches exactly on Linux
    if (typeof mod === "function") {
      return mod(sequelize, Sequelize.DataTypes);
    }
    console.warn(`[models] ${name} did not export a factory function — skipped`);
    return null;
  } catch (e) {
    console.warn(`[models] Skipping ${name}: ${e.message}`);
    return null;
  }
}

/* ------------------ load models ------------------ */
db.User             = loadModel("User");
db.Vendor           = loadModel("Vendor");
db.MenuItem         = loadModel("MenuItem");
db.Order            = loadModel("Order");
db.OrderItem        = loadModel("OrderItem");
db.Payout           = loadModel("Payout");            // <-- must exist as ./Payout.js (capital P)
db.PushSubscription = loadModel("PushSubscription");  // optional, if file exists

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