const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

exports.init = (httpServer) => {
  io = new Server(httpServer, { cors: { origin: process.env.CLIENT_URL || '*' } });

  io.use((socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
      socket.userId = payload.id;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`); // every user has a private room
  });
};

// send an event to one user (all of their open tabs/devices)
exports.notify = (userId, event, payload) => {
  if (io) io.to(`user:${String(userId)}`).emit(event, payload);
};
