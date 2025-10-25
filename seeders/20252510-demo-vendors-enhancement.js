
// seeders/20251025-demo-vendors-enhancement.js
"use strict";

/**
 * Enrich existing Vendors with marketplace fields if missing/null.
 * Safe to run multiple times.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = "Vendors";

    // read vendors
    const vendors = await queryInterface.sequelize.query(
      `SELECT id, name, cuisine, "imageUrl", description, "etaMins", "deliveryFee", "isOpen"
       FROM "Vendors"`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (!Array.isArray(vendors) || vendors.length === 0) {
      console.log("No vendors found to enrich.");
      return;
    }

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    const stockImgs = [
      "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?q=80&w=1200&auto=format&fit=crop",
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=1200&auto=format&fit=crop",
      "https://images.unsplash.com/photo-1543352634-8730abade090?q=80&w=1200&auto=format&fit=crop",
      "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?q=80&w=1200&auto=format&fit=crop",
    ];

    for (const v of vendors) {
      const updates = {};

      if (!v.imageUrl) updates.imageUrl = pick(stockImgs);
      if (!v.description) {
        updates.description =
          `${v.name || "Restaurant"} serving ${v.cuisine || "great food"}. ` +
          `Fast delivery and top-rated dishes.`;
      }
      if (v.etaMins == null) updates.etaMins = 25 + Math.floor(Math.random() * 20); // 25–44
      if (v.deliveryFee == null) updates.deliveryFee = [0, 0, 19, 29, 39][Math.floor(Math.random() * 5)];
      if (v.isOpen == null) updates.isOpen = true;

      // optional demo ratings
      if (v.ratingAvg == null) updates.ratingAvg = +(3.8 + Math.random() * 1.2).toFixed(1);
      if (v.ratingCount == null) updates.ratingCount = Math.floor(50 + Math.random() * 450);

      if (Object.keys(updates).length) {
        await queryInterface.bulkUpdate(
          table,
          updates,
          { id: v.id }
        );
      }
    }

    console.log(`Vendor enrichment complete! Updated ${vendors.length} vendor(s).`);
  },

  down: async (/* queryInterface, Sequelize */) => {
    // no-op (we won't undo demo enrichment)
  },
};