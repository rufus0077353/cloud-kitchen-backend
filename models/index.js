const Sequelize = require("sequelize");
const sequelize = require("../config/db");

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

// Import models
db.User = require("./User")(sequelize, Sequelize.DataTypes);
db.Vendor = require("./Vendor")(sequelize, Sequelize.DataTypes);
db.MenuItem = require("./MenuItem")(sequelize, Sequelize.DataTypes);
db.Order = require("./Order")(sequelize, Sequelize.DataTypes);
db.OrderItem = require("./OrderItem")(sequelize, Sequelize.DataTypes);

// Associations
Object.values(db).forEach(model => {
    if (model.associate) {
        model.associate(db);
    }
});

// Vendor -> MenuItems (1:M)
db.Vendor.hasMany(db.MenuItem );
db.MenuItem.belongsTo(db.Vendor);

// User -> Orders (1:M)
db.User.hasMany(db.Order);
db.Order.belongsTo(db.User);

// Vendor -> Orders (1:M)
db.Vendor.hasMany(db.Order);
db.Order.belongsTo(db.Vendor);

db.User.hasOne(db.Vendor, { foreignKey: "UserId" });
db.Vendor.belongsTo(db.User, { foreignkey: "UserId" });

// Order <-> MenuItem (M:N) via OrderItem
db.Order.belongsToMany(db.MenuItem, { through: db.OrderItem });
db.MenuItem.belongsToMany(db.Order, { through: db.OrderItem });

module.exports = db;
