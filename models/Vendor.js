// models/vendor.js
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define("Vendor", {
    name: { type: DataTypes.STRING, allowNull: false },
    cuisine: { type: DataTypes.STRING },
    location: { type: DataTypes.STRING, allowNull: false },
    UserId: { type: DataTypes.INTEGER, allowNull: false, unique: true }
  }, {
    tableName: 'vendors',
    timestamps: true
  });

  Vendor.associate = (models) => {
    Vendor.belongsTo(models.User, { foreignKey: 'UserId' });
    Vendor.hasMany(models.MenuItem, { foreignKey: 'VendorId' });
  };

  return Vendor;
};
