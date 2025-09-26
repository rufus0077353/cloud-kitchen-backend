module.exports = (sequelize, DataTypes) => {
  const Payout = sequelize.define(
    "Payout",
    {
      grossAmount:      { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      commissionAmount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      payoutAmount:     { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      status:           { type: DataTypes.ENUM("pending","scheduled","paid"), defaultValue: "pending" },
      scheduledAt:      { type: DataTypes.DATE, allowNull: true },
      paidAt:           { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "Payouts", timestamps: true }
  );

  Payout.associate = (models) => {
    Payout.belongsTo(models.Vendor, { foreignKey: "VendorId", onDelete: "CASCADE" });
    Payout.belongsTo(models.Order,  { foreignKey: "OrderId", onDelete: "SET NULL" }); // NOTE: OrderId (not orderId)
  };

  return Payout;
};