module.exports = (sequelize, DataTypes) => {
  const IdempotencyKey = sequelize.define(
    "IdempotencyKey",
    {
      key:   { type: DataTypes.STRING(128), allowNull: false }, // slightly longer headroom
      userId:{ type: DataTypes.INTEGER,     allowNull: false },
      orderId:{ type: DataTypes.INTEGER,    allowNull: true  },
    },
    {
      tableName: "idempotency_keys", // be explicit & stable
      indexes: [
        {
          unique: true,
          fields: ["userId", "key"], // ✅ composite uniqueness per user
          name: "uniq_user_key",
        },
      ],
    }
  );

  IdempotencyKey.associate = (models) => {
    IdempotencyKey.belongsTo(models.Order, { foreignKey: "orderId" });
  };

  return IdempotencyKey;
};