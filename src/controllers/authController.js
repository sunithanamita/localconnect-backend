const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const User = require('../models/User');
const { ApiError, asyncHandler } = require('../utils/helpers');

exports.registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
  role: z.enum(['customer', 'provider']).default('customer'), // admin can never self-register
});
exports.loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role });

exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role } = req.valid;
  if (await User.findOne({ email })) throw new ApiError(409, 'Email already registered');
  const user = await User.create({ name, email, phone, role, passwordHash: await bcrypt.hash(password, 10) });
  res.status(201).json({ success: true, token: signToken(user._id), user: publicUser(user) });
});

exports.login = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.valid.email.toLowerCase() }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(req.valid.password, user.passwordHash)))
    throw new ApiError(401, 'Invalid email or password');
  res.json({ success: true, token: signToken(user._id), user: publicUser(user) });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
});
