module.exports = (sequelize, DataTypes) => {
  const OrderItem = sequelize.define("OrderItem", {
    OrderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    MenuItemId:{
      type: DataTypes.INTEGER,
      allowNull: false
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
  });


  return OrderItem;
};
            