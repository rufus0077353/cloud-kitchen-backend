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


const getVendorOrders = async (req, res) => {
  try {
    const vendorId = req.user.id; // Assuming vendor is authenticated

    const orders = await Order.findAll({
      where: { vendorId },
      include: [
        { model: OrderItem, include: [MenuItem] },
        { model: User, attributes: ['id', 'name', 'email'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    return res.status(200).json({ orders });
  } catch (error) {
    console.error("Error fetching vendor orders:", error);
    return res.status(500).json({ error: "Failed to fetch vendor orders" });
  }
};

const updateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const order = await Order.findByPk(id);

    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.vendorId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to update this order' });
    }

    order.status = status;
    await order.save();

    return res.status(200).json({ message: 'Order status updated', order });
  } catch (error) {
    console.error("Error updating status:", error);
    return res.status(500).json({ error: "Failed to update order status" });
  }
};

