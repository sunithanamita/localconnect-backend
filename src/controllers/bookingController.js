const { z } = require('zod');
const Booking = require('../models/Booking');
const ProviderProfile = require('../models/ProviderProfile');
const { notify } = require('../sockets');
const { ApiError, asyncHandler } = require('../utils/helpers');

exports.createSchema = z.object({
  providerId: z.string().length(24),
  serviceTitle: z.string().optional(),
  scheduledAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), 'must be in the future'),
  address: z.string().min(5),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  notes: z.string().max(500).optional(),
});
exports.statusSchema = z.object({ action: z.enum(['accept', 'reject', 'cancel', 'complete']) });

const SLOT_MS = 60 * 60 * 1000; // each job blocks a 1-hour slot

const slotTaken = (providerId, when, excludeId) =>
  Booking.exists({
    provider: providerId,
    status: { $in: ['accepted', 'confirmed'] },
    scheduledAt: { $gt: new Date(when.getTime() - SLOT_MS), $lt: new Date(when.getTime() + SLOT_MS) },
    ...(excludeId && { _id: { $ne: excludeId } }),
  });

exports.create = asyncHandler(async (req, res) => {
  const { providerId, serviceTitle, scheduledAt, address, lat, lng, notes } = req.valid;
  const provider = await ProviderProfile.findById(providerId);
  if (!provider || !provider.isVerified) throw new ApiError(404, 'Provider not available');
  if (String(provider.user) === String(req.user._id)) throw new ApiError(400, 'You cannot book yourself');

  let price = provider.basePrice;
  if (serviceTitle) {
    const svc = provider.services.find((s) => s.title === serviceTitle);
    if (!svc) throw new ApiError(400, 'Unknown service for this provider');
    price = svc.price;
  }
  if (await slotTaken(provider._id, scheduledAt)) throw new ApiError(409, 'Provider is already booked at that time');

  const booking = await Booking.create({
    customer: req.user._id,
    provider: provider._id,
    category: provider.category,
    serviceTitle, scheduledAt, address, notes, price,
    city: provider.city,
    ...(lat !== undefined && lng !== undefined && { location: { type: 'Point', coordinates: [lng, lat] } }),
  });

  notify(provider.user, 'booking:new', { bookingId: booking._id, scheduledAt, price });
  res.status(201).json({ success: true, booking });
});

exports.listMine = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === 'provider') {
    const profile = await ProviderProfile.findOne({ user: req.user._id });
    if (!profile) return res.json({ success: true, bookings: [] });
    filter.provider = profile._id;
  } else {
    filter.customer = req.user._id;
  }
  if (req.query.status) filter.status = req.query.status;

  const bookings = await Booking.find(filter)
    .sort('-scheduledAt').limit(100)
    .populate('customer', 'name phone')
    .populate({ path: 'provider', select: 'user category city', populate: { path: 'user', select: 'name phone' } })
    .populate('category', 'name');
  res.json({ success: true, bookings });
});

// state machine: action -> { who may do it, allowed current states, next state }
const TRANSITIONS = {
  accept:   { by: 'provider', from: ['pending'],             to: 'accepted' },
  reject:   { by: 'provider', from: ['pending'],             to: 'rejected' },
  complete: { by: 'provider', from: ['confirmed'],           to: 'completed' },
  cancel:   { by: 'customer', from: ['pending', 'accepted'], to: 'cancelled' },
};

exports.updateStatus = asyncHandler(async (req, res) => {
  const t = TRANSITIONS[req.valid.action];
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(404, 'Booking not found');
  const provider = await ProviderProfile.findById(booking.provider);

  const isOwnerProvider = provider && String(provider.user) === String(req.user._id);
  const isOwnerCustomer = String(booking.customer) === String(req.user._id);
  if (t.by === 'provider' && !isOwnerProvider) throw new ApiError(403, 'Only the provider can do this');
  if (t.by === 'customer' && !isOwnerCustomer) throw new ApiError(403, 'Only the customer can do this');
  if (!t.from.includes(booking.status))
    throw new ApiError(400, `Cannot ${req.valid.action} a booking that is ${booking.status}`);

  if (req.valid.action === 'accept' && (await slotTaken(booking.provider, booking.scheduledAt, booking._id)))
    throw new ApiError(409, 'You already have a confirmed job in that slot');

  booking.status = t.to;
  await booking.save();

  const payload = { bookingId: booking._id, status: booking.status };
  notify(t.by === 'provider' ? booking.customer : provider.user, 'booking:updated', payload);
  res.json({ success: true, booking });
});
