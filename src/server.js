require('dotenv').config();
const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const { init: initSockets } = require('./sockets');

const PORT = process.env.PORT || 5000;

(async () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  await connectDB();
  const server = http.createServer(app);
  initSockets(server);
  server.listen(PORT, '0.0.0.0', () => console.log(`LocalConnect API running on port ${PORT}`));
})().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
