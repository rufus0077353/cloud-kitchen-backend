// models/payout.js
module.exports = (sequelize, Sequelize) => {
  const Payout = sequelize.define('Payout', {
    grossAmount: Sequelize.FLOAT,
    commissionAmount: Sequelize.FLOAT,
    payoutAmount: Sequelize.FLOAT,
    status: { type: Sequelize.ENUM('pending','scheduled','paid'), defaultValue: 'pending' },
    scheduledAt: Sequelize.DATE,
    paidAt: Sequelize.DATE,
  });
  Payout.associate = (models) => {
    Payout.belongsTo(models.Vendor, { foreignKey: 'VendorId' });
    Payout.belongsTo(models.Order,  { foreignKey: 'orderId' });
  };
  return Payout;
};