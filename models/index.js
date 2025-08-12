const Sequelize = require("sequelize");
const sequelize = require("../config/db");

const db = {};
db.Sequelize = Sequelize;
db.sequelize = sequelize;

// Load models
db.User = require("./User")(sequelize, Sequelize.DataTypes);
db.Vendor = require("./Vendor")(sequelize, Sequelize.DataTypes);
db.MenuItem = require("./MenuItem")(sequelize, Sequelize.DataTypes);
db.Order = require("./Order")(sequelize, Sequelize.DataTypes);
db.OrderItem = require("./OrderItem")(sequelize, Sequelize.DataTypes);
db.PushSubscription = require("./PushSubscription")(sequelize, Sequelize.DataTypes);

/**
 * Associations — single source of truth
 * (If you also defined `associate(models)` inside individual model files,
 *  delete those to avoid duplicates, or remove this section and call them instead.)
 */

// User ↔ Vendor (1:1)
db.User.hasOne(db.Vendor, { foreignKey: "UserId", onDelete: "CASCADE" });
db.Vendor.belongsTo(db.User, { foreignKey: "UserId" });

// Vendor ↔ MenuItem (1:M)
db.Vendor.hasMany(db.MenuItem, { foreignKey: "VendorId", onDelete: "CASCADE" });
db.MenuItem.belongsTo(db.Vendor, { foreignKey: "VendorId" });

// User ↔ Order (1:M)
db.User.hasMany(db.Order, { foreignKey: "UserId", onDelete: "SET NULL" });
db.Order.belongsTo(db.User, { foreignKey: "UserId" });

// Vendor ↔ Order (1:M)
db.Vendor.hasMany(db.Order, { foreignKey: "VendorId", onDelete: "SET NULL" });
db.Order.belongsTo(db.Vendor, { foreignKey: "VendorId" });

// Order ↔ OrderItem (1:M)
db.Order.hasMany(db.OrderItem, { foreignKey: "OrderId", onDelete: "CASCADE" });
db.OrderItem.belongsTo(db.Order, { foreignKey: "OrderId" });

// MenuItem ↔ OrderItem (1:M)
db.MenuItem.hasMany(db.OrderItem, { foreignKey: "MenuItemId", onDelete: "CASCADE" });
db.OrderItem.belongsTo(db.MenuItem, { foreignKey: "MenuItemId" });

db.User.hasMany(db.PushSubscription, { foreignKey: "userId", onDelete: "CASCADE" });
db.PushSubscription.belongsTo(db.User, { foreignKey: "userId" });

// Optional: Order ↔ MenuItem (M:N) via OrderItem (explicit keys)
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

module.exports = db;