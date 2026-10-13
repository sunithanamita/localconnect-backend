const mongoose = require('mongoose');
const { z } = require('zod');
const ProviderProfile = require('../models/ProviderProfile');
const Category = require('../models/Category');
const Booking = require('../models/Booking');
const Review = require('../models/Review');
const { ApiError, asyncHandler, escapeRegex } = require('../utils/helpers');

exports.profileSchema = z.object({
  categoryId: z.string().length(24),
  bio: z.string().max(1000).optional(),
  experienceYears: z.coerce.number().min(0).default(0),
  basePrice: z.coerce.number().min(0),
  services: z.array(z.object({ title: z.string().min(2), price: z.coerce.number().min(0) })).default([]),
  address: z.string().optional(),
  city: z.string().optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

exports.searchSchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.1).max(100).default(10),
  category: z.string().optional(), // category slug
  minRating: z.coerce.number().min(0).max(5).optional(),
  q: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(10),
});

const POPULATE = [
  { path: 'user', select: 'name phone' },
  { path: 'category', select: 'name slug' },
];

// Provider creates / updates own profile (stays unverified until admin approves)
exports.upsertMyProfile = asyncHandler(async (req, res) => {
  const { categoryId, lat, lng, ...rest } = req.valid;
  if (!(await Category.exists({ _id: categoryId }))) throw new ApiError(400, 'Unknown category');
  const profile = await ProviderProfile.findOneAndUpdate(
    { user: req.user._id },
    { ...rest, category: categoryId, location: { type: 'Point', coordinates: [lng, lat] }, user: req.user._id },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).populate(POPULATE);
  res.json({ success: true, profile });
});

// Geolocation search: nearest VERIFIED providers first
exports.search = asyncHandler(async (req, res) => {
  const { lat, lng, radiusKm, category, minRating, q, page, limit } = req.valid;
  const match = { isVerified: true };

  if (category) {
    const cat = await Category.findOne({ slug: category.toLowerCase() });
    if (!cat) return res.json({ success: true, page, count: 0, providers: [] });
    match.category = cat._id; // aggregation does not auto-cast, so use the real ObjectId
  }
  if (minRating) match.ratingAvg = { $gte: minRating };
  if (q) match['services.title'] = { $regex: escapeRegex(q), $options: 'i' };

  let providers;
  if (lat !== undefined && lng !== undefined) {
    providers = await ProviderProfile.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng, lat] },
          distanceField: 'distanceMeters',
          maxDistance: radiusKm * 1000,
          spherical: true,
          query: match,
        },
      },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]);
    providers = await ProviderProfile.populate(providers, POPULATE);
  } else {
    providers = await ProviderProfile.find(match)
      .sort({ ratingAvg: -1, ratingCount: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(POPULATE)
      .lean();
  }
  res.json({ success: true, page, count: providers.length, providers });
});

exports.getById = asyncHandler(async (req, res) => {
  const profile = await ProviderProfile.findById(req.params.id).populate(POPULATE);
  if (!profile) throw new ApiError(404, 'Provider not found');
  res.json({ success: true, provider: profile });
});

exports.getReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ provider: req.params.id })
    .sort('-createdAt').limit(50).populate('customer', 'name');
  res.json({ success: true, reviews });
});

// Provider dashboard: bookings by status + earnings
exports.myDashboard = asyncHandler(async (req, res) => {
  const profile = await ProviderProfile.findOne({ user: req.user._id }).populate(POPULATE);
  if (!profile) throw new ApiError(404, 'Create your provider profile first');

  const byStatus = await Booking.aggregate([
    { $match: { provider: profile._id } },
    { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$price' } } },
  ]);
  const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
  const earned = byStatus.find((s) => s._id === 'completed')?.amount || 0;
  const upcomingPaid = byStatus.find((s) => s._id === 'confirmed')?.amount || 0;

  res.json({
    success: true,
    profile,
    stats: { counts, totalEarnings: earned, upcomingPaidAmount: upcomingPaid },
  });
});
