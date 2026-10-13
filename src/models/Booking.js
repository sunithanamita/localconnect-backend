const mongoose = require('mongoose');

const STATUSES = ['pending', 'accepted', 'rejected', 'confirmed', 'completed', 'cancelled'];

const bookingSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderProfile', required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    serviceTitle: { type: String },
    scheduledAt: { type: Date, required: true },
    address: { type: String, required: true },
    city: { type: String },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number] },
    },
    notes: { type: String, maxlength: 500 },
    price: { type: Number, required: true }, // INR, snapshot at booking time
    status: { type: String, enum: STATUSES, default: 'pending', index: true },
  },
  { timestamps: true }
);

bookingSchema.index({ provider: 1, scheduledAt: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
