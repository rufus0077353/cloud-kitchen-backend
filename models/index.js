
const Sequelize = require("sequelize");
const sequelize = require("../config/db");

const db = {};
db.Sequelize = Sequelize;
db.sequelize = sequelize;

// Models
db.User          = require("./User")(sequelize, Sequelize.DataTypes);
db.Vendor        = require("./Vendor")(sequelize, Sequelize.DataTypes);
db.MenuItem      = require("./MenuItem")(sequelize, Sequelize.DataTypes);
db.Order         = require("./Order")(sequelize, Sequelize.DataTypes);
db.OrderItem     = require("./OrderItem")(sequelize, Sequelize.DataTypes);
db.Payout        = require("./Payout")(sequelize, Sequelize.DataTypes);
db.PushSubscription = require("./PushSubscription")(sequelize, Sequelize.DataTypes);

// Associations
db.User.hasOne(db.Vendor, { foreignKey: "UserId", onDelete: "CASCADE" });
db.Vendor.belongsTo(db.User, { foreignKey: "UserId" });

db.Vendor.hasMany(db.MenuItem, { foreignKey: "VendorId", onDelete: "CASCADE" });
db.MenuItem.belongsTo(db.Vendor, { foreignKey: "VendorId" });

db.User.hasMany(db.Order, { foreignKey: "UserId", onDelete: "CASCADE" });
db.Order.belongsTo(db.User, { foreignKey: "UserId" });

db.Vendor.hasMany(db.Order, { foreignKey: "VendorId", onDelete: "CASCADE" });
db.Order.belongsTo(db.Vendor, { foreignKey: "VendorId" });

db.Order.hasMany(db.OrderItem, { foreignKey: "OrderId", onDelete: "CASCADE" });
db.OrderItem.belongsTo(db.Order, { foreignKey: "OrderId" });

db.MenuItem.hasMany(db.OrderItem, { foreignKey: "MenuItemId", onDelete: "CASCADE" });
db.OrderItem.belongsTo(db.MenuItem, { foreignKey: "MenuItemId" });

db.User.hasMany(db.PushSubscription, { foreignKey: "userId", onDelete: "CASCADE" });
db.PushSubscription.belongsTo(db.User, { foreignKey: "userId" });

// NEW: Vendor ↔ Payout (1:M)
db.Vendor.hasMany(db.Payout, { foreignKey: "VendorId", onDelete: "CASCADE" });
db.Payout.belongsTo(db.Vendor, { foreignKey: "VendorId" });

// NEW: Order ↔ Payout (1:1)
db.Order.hasOne(db.Payout, { foreignKey: "OrderId", onDelete: "SET NULL" });
db.Payout.belongsTo(db.Order, { foreignKey: "OrderId" });

// Convenience M:N
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