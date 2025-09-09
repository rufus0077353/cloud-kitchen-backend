module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define("Vendor", {
    name:     { type: DataTypes.STRING, allowNull: false },
    cuisine:  { type: DataTypes.STRING },
    location: { type: DataTypes.STRING, allowNull: false },
    UserId:   { type: DataTypes.INTEGER, allowNull: false, unique: true },
    // NEW: open/closed switch
    isOpen:   { type: DataTypes.BOOLEAN, allowNull:false , defaultValue: true },
    commissionRate: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0.15 }, // 15% default
  }, {
    tableName: "vendors",
    timestamps: true,
  });

  return Vendor;
};
