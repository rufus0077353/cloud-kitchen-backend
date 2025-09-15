// models/Vendor.js
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define("Vendor", {
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    cuisine: {
      type: DataTypes.STRING
    },
    location: {
      type: DataTypes.STRING,
      allowNull: false
    },
    UserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true
    },

    // NEW: open/closed switch
    isOpen: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },

    // Commission rate: stored as decimal (0.15 = 15%)
    // ✅ allowNull true so it won’t force reset
    commissionRate: {
      type: DataTypes.FLOAT,
      allowNull: true,         
      defaultValue: 0.15        // fallback if none is set
    },
  }, {
    tableName: "vendors",
    timestamps: true,
  });

  return Vendor;
};