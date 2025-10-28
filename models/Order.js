// models/order.js
"use strict";

module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define(
    "Order",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      // core
      UserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onDelete: "CASCADE",
      },
      VendorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Vendors", key: "id" },
        onDelete: "SET NULL",
      },

      status: {
        // pending | accepted | ready | delivered | rejected
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pending",
      },

      totalAmount: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        defaultValue: 0,
      },

      paymentMethod: {
        // 'cod' | 'mock_online' | 'online'
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: "cod",
      },

      paymentStatus: {
        // 'unpaid' | 'processing' | 'paid' | 'failed' | 'refunded'
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: "unpaid",
      },

      address: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      /* ---------- NEW: ratings / reviews (SAFE DEFAULTS) ---------- */
      rating: {
        // 1.0 - 5.0; keep NULL until user rates
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: null,
        validate: {
          min: 1,
          max: 5,
        },
      },
      review: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null,
      },
      ratedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      isRated: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      reviewReply: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      /* timestamps */
      createdAt: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: sequelize.fn("NOW"),
      },
      updatedAt: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: sequelize.fn("NOW"),
      },
    },
    {
      tableName: "Orders",
      timestamps: true,
    }
  );

  Order.associate = (models) => {
    Order.belongsTo(models.User, { foreignKey: "UserId" });
    Order.belongsTo(models.Vendor, { foreignKey: "VendorId" });

    if (models.OrderItem) {
      Order.hasMany(models.OrderItem, { foreignKey: "OrderId", as: "OrderItems" });
    }
    // Optional many-to-many convenience
    if (models.MenuItem && models.OrderItem) {
      Order.belongsToMany(models.MenuItem, {
        through: models.OrderItem,
        foreignKey: "OrderId",
        otherKey: "MenuItemId",
        as: "MenuItems",
      });
    }
  };

  return Order;
};