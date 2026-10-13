const crypto = require('crypto');
const Razorpay = require('razorpay');
const { z } = require('zod');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const ProviderProfile = require('../models/ProviderProfile');
const { notify } = require('../sockets');
const { ApiError, asyncHandler } = require('../utils/helpers');

exports.orderSchema = z.object({ bookingId: z.string().length(24) });
exports.verifySchema = z.object({
  bookingId: z.string().length(24),
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});

const isMock = () => !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET;
let client;
const rz = () => (client ||= new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
}));

// Step 1: customer asks to pay for an ACCEPTED booking -> we create a gateway order
exports.createOrder = asyncHandler(async (req, res) => {
  const booking = await Booking.findOne({ _id: req.valid.bookingId, customer: req.user._id });
  if (!booking) throw new ApiError(404, 'Booking not found');
  if (booking.status !== 'accepted') throw new ApiError(400, 'Booking must be accepted by the provider before payment');

  let orderId;
  if (isMock()) {
    orderId = `order_mock_${crypto.randomBytes(6).toString('hex')}`;
  } else {
    const order = await rz().orders.create({
      amount: Math.round(booking.price * 100), // paise
      currency: 'INR',
      receipt: String(booking._id),
    });
    orderId = order.id;
  }
  await Payment.create({ booking: booking._id, customer: req.user._id, orderId, amount: booking.price });

  res.status(201).json({
    success: true,
    mock: isMock(),
    order: { id: orderId, amount: Math.round(booking.price * 100), currency: 'INR' },
    keyId: process.env.RAZORPAY_KEY_ID || null,
  });
});

// Step 2: after checkout, frontend sends the 3 Razorpay values; we verify the signature
exports.verify = asyncHandler(async (req, res) => {
  const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.valid;
  const payment = await Payment.findOne({ orderId: razorpay_order_id, booking: bookingId, customer: req.user._id });
  if (!payment) throw new ApiError(404, 'Payment order not found');
  if (payment.status === 'paid') return res.json({ success: true, message: 'Already verified' });

  let valid;
  if (isMock()) {
    valid = razorpay_signature === 'mock_signature';
  } else {
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(razorpay_signature);
    valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!valid) {
    payment.status = 'failed';
    await payment.save();
    throw new ApiError(400, 'Payment signature verification failed');
  }

  payment.status = 'paid';
  payment.paymentId = razorpay_payment_id;
  await payment.save();

  const booking = await Booking.findByIdAndUpdate(bookingId, { status: 'confirmed' }, { new: true });
  const provider = await ProviderProfile.findById(booking.provider);
  const payload = { bookingId: booking._id, status: 'confirmed' };
  notify(provider.user, 'booking:updated', payload);
  notify(booking.customer, 'booking:updated', payload);

  res.json({ success: true, message: 'Payment verified, slot confirmed', booking });
});
