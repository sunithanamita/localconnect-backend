const { z } = require('zod');
const Booking = require('../models/Booking');
const Review = require('../models/Review');
const ProviderProfile = require('../models/ProviderProfile');
const { ApiError, asyncHandler } = require('../utils/helpers');

exports.createSchema = z.object({
  bookingId: z.string().length(24),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

exports.create = asyncHandler(async (req, res) => {
  const { bookingId, rating, comment } = req.valid;
  const booking = await Booking.findOne({ _id: bookingId, customer: req.user._id });
  if (!booking) throw new ApiError(404, 'Booking not found');
  if (booking.status !== 'completed') throw new ApiError(400, 'You can only review completed bookings');
  if (await Review.exists({ booking: bookingId })) throw new ApiError(409, 'Already reviewed');

  const review = await Review.create({
    booking: bookingId, customer: req.user._id, provider: booking.provider, rating, comment,
  });

  // recompute provider rating (always accurate, no drift)
  const [agg] = await Review.aggregate([
    { $match: { provider: booking.provider } },
    { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
  ]);
  await ProviderProfile.findByIdAndUpdate(booking.provider, {
    ratingAvg: Math.round(agg.avg * 10) / 10,
    ratingCount: agg.n,
  });

  res.status(201).json({ success: true, review });
});
