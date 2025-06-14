const db = require("../models"); // This imports index.js from models
const { Order, OrderItem, MenuItem } = db;

const createOrder = async (req, res) => {
  try {
    const { userId, vendorId, items } = req.body; // items: [{ menuItemId, quantity }]

    // Create the order
    const order = await Order.create({ userId, vendorId });

    // Prepare order items
    for (const item of items) {
      const menuItem = await MenuItem.findByPk(item.menuItemId);
      if (!menuItem) {
        return res.status(404).json({ error: `Menu item not found: ID ${item.menuItemId}` });
      }

      await OrderItem.create({
        OrderId: order.id,
        MenuItemId: menuItem.id,
        quantity: item.quantity,
        priceAtOrder: menuItem.price,
      });
    }

    return res.status(201).json({ message: "Order placed successfully", orderId: order.id });
  } catch (error) {
    console.error("Error creating order:", error);
    return res.status(500).json({ error: "Failed to place order" });
  }
};
