module.exports = (sequelize, DataTypes) => {
  const IdempotencyKey = sequelize.define("IdempotencyKey", {
    key: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    orderId: { type: DataTypes.INTEGER, allowNull: true },
  }, {});
  IdempotencyKey.associate = (models) => {
    IdempotencyKey.belongsTo(models.Order, { foreignKey: "orderId" });
  };
  return IdempotencyKey;
};
