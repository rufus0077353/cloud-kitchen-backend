// controllers/payoutController.js
const { Order, Vendor } = require("../models");

exports.getVendorPayoutSummary = async (req, res) => {
  try {
    const vendorId = req.user.vendorId || req.query.vendorId;
    if (!vendorId) return res.status(400).json({ error: "Vendor ID missing" });

    const orders = await Order.findAll({
      where: { VendorId: vendorId, status: "delivered" },
    });

    const grossPaid = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const commission = grossPaid * 0.15;
    const netOwed = grossPaid - commission;

    res.json({
      paidOrders: orders.length,
      grossPaid,
      commission,
      netOwed,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch vendor payouts" });
  }
};

exports.getAllPayoutSummaries = async (req, res) => {
  try {
    const vendors = await Vendor.findAll({ include: [Order] });
    const result = vendors.map(v => {
      const orders = v.Orders.filter(o => o.status === "delivered");
      const grossPaid = orders.reduce((sum, o) => sum + o.totalAmount, 0);
      const commission = grossPaid * 0.15;
      const netOwed = grossPaid - commission;
      return {
        vendorName: v.name,
        paidOrders: orders.length,
        grossPaid,
        commission,
        netOwed,
      };
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch admin payout summary" });
  }
};