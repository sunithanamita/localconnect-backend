require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Category = require('../models/Category');
const ProviderProfile = require('../models/ProviderProfile');

const CENTER = { lat: Number(process.env.SEED_LAT), lng: Number(process.env.SEED_LNG) };
const jitter = () => (Math.random() - 0.5) * 0.08; // roughly +-4 km

const CATEGORIES = ['Electrician', 'Plumber', 'Tutor', 'Salon', 'Carpenter', 'AC Repair'];

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.MONGODB_URL;
  await mongoose.connect(uri);
  await Promise.all([User.deleteMany({}), Category.deleteMany({}), ProviderProfile.deleteMany({})]);

  const hash = await bcrypt.hash('Test@12345', 10);
  await User.create({
    name: 'Admin', email: process.env.ADMIN_EMAIL, role: 'admin',
    passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 10),
  });
  await User.create({ name: 'Demo Customer', email: 'customer@localconnect.dev', role: 'customer', passwordHash: hash });

  const cats = await Category.insertMany(
    CATEGORIES.map((name) => ({ name, slug: name.toLowerCase().replace(/\s+/g, '-') }))
  );

  for (let i = 0; i < 12; i++) {
    const cat = cats[i % cats.length];
    const user = await User.create({
      name: `${cat.name} Pro ${i + 1}`, email: `provider${i + 1}@localconnect.dev`,
      phone: `90000000${String(i).padStart(2, '0')}`, role: 'provider', passwordHash: hash,
    });
    await ProviderProfile.create({
      user: user._id, category: cat._id,
      bio: `Experienced ${cat.name.toLowerCase()} offering reliable doorstep service.`,
      experienceYears: 1 + (i % 9), basePrice: 300 + (i % 5) * 100,
      services: [{ title: `${cat.name} visit`, price: 300 + (i % 5) * 100 }, { title: `${cat.name} full job`, price: 800 + (i % 4) * 150 }],
      address: 'Demo address', city: 'Demo City', isVerified: i % 6 !== 5, // a couple stay unverified for admin testing
      location: { type: 'Point', coordinates: [CENTER.lng + jitter(), CENTER.lat + jitter()] },
    });
  }

  await ProviderProfile.syncIndexes();
  console.log('Seeded. Logins -> admin:', process.env.ADMIN_EMAIL, '| customer@localconnect.dev | provider1@localconnect.dev (pwd Test@12345)');
  await mongoose.disconnect();
})();
