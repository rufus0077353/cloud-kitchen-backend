
module.exports = (sequelize, DataTypes) => {
  const IdempotencyKey = sequelize.define(
    "IdempotencyKey",
    {
      key:     { type: DataTypes.STRING(128), allowNull: false },
      userId:  { type: DataTypes.INTEGER,     allowNull: false },
      orderId: { type: DataTypes.INTEGER,     allowNull: true  },
    },
    {
      tableName: "IdempotencyKeys",
      timestamps: true,
      indexes: [{ unique: true, fields: ["userId", "key"], name: "uniq_user_key" }],
    }
  );

  IdempotencyKey.associate = (models) => {
    IdempotencyKey.belongsTo(models.Order, { foreignKey: "orderId" });
  };

  return IdempotencyKey;
};