"use strict";
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");

let io = null;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || "http://localhost:4200",
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // JWT authentication middleware for WebSocket connections
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(" ")[1];
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        socket.join(`user:${decoded.id}`);
      }
    } catch {
      // Anonymous connection — still allowed
    }
    next();
  });

  io.on("connection", (socket) => {
    logger.debug(
      `WebSocket connected: ${socket.id} (user: ${socket.userId ?? "anon"})`,
    );

    socket.on("subscribe:job", (jobId) => {
      socket.join(`job:${jobId}`);
    });

    socket.on("unsubscribe:job", (jobId) => {
      socket.leave(`job:${jobId}`);
    });

    socket.on("disconnect", () => {
      logger.debug(`WebSocket disconnected: ${socket.id}`);
    });
  });

  logger.info("WebSocket server initialized");
  return io;
};

// Emit job progress to all subscribers
const emitJobProgress = (jobId, data) => {
  if (!io) return;
  io.to(`job:${jobId}`).emit("job:progress", { jobId, ...data });
};

// Emit job completion
const emitJobComplete = (jobId, result, userId = null) => {
  if (!io) return;
  io.to(`job:${jobId}`).emit("job:complete", { jobId, result });
  if (userId) io.to(`user:${userId}`).emit("job:complete", { jobId, result });
};

// Emit job failure
const emitJobFailed = (jobId, error, userId = null) => {
  if (!io) return;
  io.to(`job:${jobId}`).emit("job:failed", { jobId, error });
  if (userId) io.to(`user:${userId}`).emit("job:failed", { jobId, error });
};

// Emit to a specific user
const emitToUser = (userId, event, data) => {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
};

// Broadcast to all connected clients (admin announcements)
const broadcast = (event, data) => {
  if (!io) return;
  io.emit(event, data);
};

const getIO = () => io;

module.exports = {
  initSocket,
  emitJobProgress,
  emitJobComplete,
  emitJobFailed,
  emitToUser,
  broadcast,
  getIO,
};
