const { z } = require('zod');
const Category = require('../models/Category');
const { asyncHandler } = require('../utils/helpers');

exports.createSchema = z.object({ name: z.string().min(2), icon: z.string().optional() });

exports.list = asyncHandler(async (req, res) => {
  res.json({ success: true, categories: await Category.find().sort('name') });
});

exports.create = asyncHandler(async (req, res) => {
  const { name, icon } = req.valid;
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const category = await Category.create({ name, slug, icon });
  res.status(201).json({ success: true, category });
});
