const mongoose = require('mongoose');

const providerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    bio: { type: String, maxlength: 1000 },
    experienceYears: { type: Number, default: 0, min: 0 },
    basePrice: { type: Number, required: true, min: 0 }, // INR
    services: [{ title: { type: String, required: true }, price: { type: Number, required: true, min: 0 } }],
    address: { type: String },
    city: { type: String, index: true },
    // GeoJSON: coordinates are [longitude, latitude]  (NOT lat, lng!)
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    isVerified: { type: Boolean, default: false }, // admin flips this
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

providerSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('ProviderProfile', providerSchema);
