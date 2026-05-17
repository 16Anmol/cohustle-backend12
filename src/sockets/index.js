import { Server } from "socket.io";
import jwt        from "jsonwebtoken";
import User       from "../models/User.js";

let io;

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin:      [process.env.CLIENT_URL, "http://localhost:8080", "http://localhost:5173"],
      credentials: true,
    },
  });

  // ── Auth middleware — verify JWT on every connection ─────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Unauthorized: no token"));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user    = await User.findById(decoded.id).select("_id role fullName avatar");
      if (!user) return next(new Error("Unauthorized: user not found"));
      socket.user = user;
      next();
    } catch {
      next(new Error("Unauthorized: invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.user._id.toString();
    console.log(`🔌 ${socket.user.fullName} connected`);

    // Each user joins their own private room
    socket.join(`user:${userId}`);

    // Join role-based room for broadcasts
    if (socket.user.role) socket.join(`role:${socket.user.role}`);

    // ── Meeting ended — relay to the other participant ────────────────────────
    socket.on("meeting:ended", ({ conversationId, roomId, otherUserId }) => {
      // otherUserId is sent by the frontend (the participant who should be notified)
      if (otherUserId) {
        io.to(`user:${otherUserId}`).emit("meeting:ended", { conversationId, roomId });
      }
    });

    // ── Typing indicators ────────────────────────────────────────────────────
    socket.on("typing:start", ({ toUserId, conversationId }) => {
      if (!toUserId) return;
      io.to(`user:${toUserId}`).emit("typing:start", {
        fromUserId:     userId,
        fromName:       socket.user.fullName,
        conversationId,
      });
    });

    socket.on("typing:stop", ({ toUserId, conversationId }) => {
      if (!toUserId) return;
      io.to(`user:${toUserId}`).emit("typing:stop", {
        fromUserId: userId,
        conversationId,
      });
    });

    // ── Online status ───────────────────────────────────────────────────────────
    // Broadcast to everyone that this user is online
    socket.broadcast.emit("user:online", { userId });

    socket.on("disconnect", () => {
      console.log(`🔌 ${socket.user.fullName} disconnected`);
      socket.broadcast.emit("user:offline", { userId });
    });
  });

  return io;
};

export const emitToUser = (userId, event, data) =>
  io?.to(`user:${userId}`).emit(event, data);

export const emitToRole = (role, event, data) =>
  io?.to(`role:${role}`).emit(event, data);

export const emitToAll = (event, data) =>
  io?.emit(event, data);

export const getIO = () => io;
