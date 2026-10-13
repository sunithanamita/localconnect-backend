// Exports bookings as flat NDJSON for BigQuery:  npm run export:bq
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const Booking = require('../src/models/Booking');
require('../src/models/Category');
const Review = require('../src/models/Review');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const reviews = Object.fromEntries((await Review.find().lean()).map((r) => [String(r.booking), r.rating]));
  const rows = await Booking.find().populate('category', 'name').lean();

  const lines = rows.map((b) => JSON.stringify({
    booking_id: String(b._id),
    customer_id: String(b.customer),
    provider_id: String(b.provider),
    category: b.category?.name ?? null,
    city: b.city ?? null,
    status: b.status,
    price: b.price,
    scheduled_at: b.scheduledAt.toISOString(),
    created_at: b.createdAt.toISOString(),
    rating: reviews[String(b._id)] ?? null,
  }));
  fs.writeFileSync('bookings.ndjson', lines.join('\n'));
  console.log(`Wrote ${lines.length} rows to bookings.ndjson`);
  await mongoose.disconnect();
})();
