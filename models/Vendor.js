// models/Vendor.js
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define("Vendor", {
    name: { type: DataTypes.STRING, allowNull: true },
    cuisine: { type: DataTypes.STRING },
    location: { type: DataTypes.STRING, allowNull: false },
    UserId: { type: DataTypes.INTEGER, allowNull: false, unique: true },

    isOpen: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    // ⬇️ allow null so “use default 15%” is possible; default only applies on INSERT
    commissionRate: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0.15 },
  }, {
    tableName: "vendors",
    timestamps: true,
  });

  return Vendor;
};