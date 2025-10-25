// models/PayoutLog.js
module.exports = (sequelize, DataTypes) => {
  const PayoutLog = sequelize.define(
    "PayoutLog",
    {
      action:        { type: DataTypes.ENUM("scheduled","paid","note"), allowNull: false },
      adminUser:     { type: DataTypes.STRING, allowNull: false }, // store email or id
      note:          { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: "PayoutLogs", timestamps: true }
  );

  PayoutLog.associate = (models) => {
    PayoutLog.belongsTo(models.Payout, { foreignKey: "PayoutId", onDelete: "CASCADE" });
    PayoutLog.belongsTo(models.Vendor, { foreignKey: "VendorId", onDelete: "CASCADE" });
  };

  return PayoutLog;
};