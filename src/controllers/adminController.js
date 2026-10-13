const { z } = require('zod');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const ProviderProfile = require('../models/ProviderProfile');
const { ApiError, asyncHandler } = require('../utils/helpers');

exports.verifySchema = z.object({ isVerified: z.boolean() });

exports.listProviders = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.verified !== undefined) filter.isVerified = req.query.verified === 'true';
  const providers = await ProviderProfile.find(filter)
    .sort('-createdAt').limit(100)
    .populate('user', 'name email phone').populate('category', 'name');
  res.json({ success: true, providers });
});

exports.setVerified = asyncHandler(async (req, res) => {
  const p = await ProviderProfile.findByIdAndUpdate(req.params.id, { isVerified: req.valid.isVerified }, { new: true });
  if (!p) throw new ApiError(404, 'Provider not found');
  res.json({ success: true, provider: p });
});

// Powers the admin dashboard charts
exports.analytics = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [users, providers, verifiedProviders, bookings, byStatus, byCategory, perDay, byCity, topProviders, revenue] =
    await Promise.all([
      User.countDocuments({ role: 'customer' }),
      ProviderProfile.countDocuments(),
      ProviderProfile.countDocuments({ isVerified: true }),
      Booking.countDocuments(),
      Booking.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Booking.aggregate([
        { $group: { _id: '$category', bookings: { $sum: 1 }, value: { $sum: '$price' } } },
        { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'cat' } },
        { $project: { _id: 0, category: { $arrayElemAt: ['$cat.name', 0] }, bookings: 1, value: 1 } },
        { $sort: { bookings: -1 } },
      ]),
      Booking.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, bookings: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Booking.aggregate([
        { $match: { city: { $ne: null } } },
        { $group: { _id: '$city', bookings: { $sum: 1 } } },
        { $sort: { bookings: -1 } }, { $limit: 10 },
      ]),
      ProviderProfile.find({ isVerified: true, ratingCount: { $gt: 0 } })
        .sort({ ratingAvg: -1, ratingCount: -1 }).limit(5).populate('user', 'name').select('user ratingAvg ratingCount'),
      Payment.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    ]);

  res.json({
    success: true,
    totals: { customers: users, providers, verifiedProviders, bookings, revenue: revenue[0]?.total || 0 },
    bookingsByStatus: byStatus,
    bookingsByCategory: byCategory,
    bookingsPerDayLast30: perDay,
    bookingsByCity: byCity,
    topProviders,
  });
});
