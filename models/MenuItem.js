module.exports = (sequelize, DataTypes) => {
  const MenuItem = sequelize.define("MenuItem", {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    price: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
    },
    VendorId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    }
  });


  return MenuItem;
};
