const mongoose = require('mongoose');

module.exports = async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.MONGODB_URL || process.env.DATABASE_URL;
  if (!uri) throw new Error('MONGO_URI or MONGO_URL is not set');
  await mongoose.connect(uri);
  console.log('MongoDB connected');
};
