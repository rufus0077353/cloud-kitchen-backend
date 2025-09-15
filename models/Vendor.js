module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define("Vendor", {
    name:     { type: DataTypes.STRING, allowNull: false },
    cuisine:  { type: DataTypes.STRING },
    location: { type: DataTypes.STRING, allowNull: false },
    UserId:   { type: DataTypes.INTEGER, allowNull: false, unique: true },
    // NEW: open/closed switch
    isOpen:   { type: DataTypes.BOOLEAN, allowNull:false , defaultValue: true },
    commissionRate: { type: DataTypes.DECIMAL(5,4), allowNull: true}, //null use platform default
  }, {
    tableName: "vendors",
    timestamps: true,
  });

  return Vendor;
};
``