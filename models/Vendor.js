const { Timestamp } = require("firebase-admin/firestore");

// models/vendor.js
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define("Vendor", {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    cuisine: {
      type: DataTypes.STRING,
    },
    location: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    UserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    }
  }, {
    tableName: 'vendors',
    timestamps: true
  });

  return Vendor;
};