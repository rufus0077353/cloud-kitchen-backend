const express = require("express");
const router = express.Router();
const { Order, OrderItem } = require("../models");

// Create a new order
router.post("/", async (req, res) => {
  try {
    const { userId, vendorId, items } = req.body;

    // Create Order
    const order = await Order.create({ userId, vendorId });

    // Create OrderItems
    const orderItems = items.map((item) => ({
      orderId: order.id,
      menuItemId: item.menuItemId,
      quantity: item.quantity,
    }));

    await OrderItem.bulkCreate(orderItems);

    res.status(201).json({ message: "Order created successfully", orderId: order.id });
  } catch (err) {
    console.error("Error creating order:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
