import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import "./config/passport.js";

import authRoutes        from "./routes/auth.js";
import profileRoutes     from "./routes/profile.js";
import problemRoutes     from "./routes/problems.js";
import applicationRoutes from "./routes/applications.js";
import messageRoutes     from "./routes/messages.js";
import milestoneRoutes   from "./routes/milestones.js";
import ratingRoutes      from "./routes/ratings.js";
import collabRoutes      from "./routes/collabRequests.js";
import collabPitchRoutes from "./routes/collabPitches.js";
import adminRoutes       from "./routes/admin.js";
import reportRoutes      from "./routes/reports.js";
import userActionsRoutes from "./routes/userActions.js";
import { initSocket }    from "./sockets/index.js";
import { startChangeStreams } from "./streams/changeStreams.js";

const app        = express();
const httpServer = http.createServer(app);
const PORT       = process.env.PORT || 5000;

// ── CORS ───────────────────────────────────────────────────────────────────────
// Allow the frontend (port 8080) to call the backend (port 5000)
const allowedOrigins = [
  "http://localhost:8080",   // Vite frontend
  "http://localhost:5173",   // fallback Vite port
  "http://localhost:3000",   // fallback CRA port
  "http://localhost:6053",   // Admin panel
  "http://127.0.0.1:6053",  // Admin panel (alternate)
  process.env.CLIENT_URL,    // from .env
  process.env.ADMIN_URL,     // admin panel deployed URL
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow Postman / curl (no origin header) and allowed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    console.warn(`⚠️  CORS blocked request from: ${origin}`);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());

// ── Health check ───────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    database: mongoose.connection.name,
    time: new Date().toISOString(),
  })
);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use("/api/auth",            authRoutes);
app.use("/api/profile",         profileRoutes);
app.use("/api/problems",        problemRoutes);
app.use("/api/applications",    applicationRoutes);
app.use("/api/messages",        messageRoutes);
app.use("/api/milestones",      milestoneRoutes);
app.use("/api/ratings",         ratingRoutes);
app.use("/api/collab-requests", collabRoutes);
app.use("/api/collab-pitches",   collabPitchRoutes);
app.use("/api/admin",           adminRoutes);
app.use("/api/reports",          reportRoutes);
app.use("/api/user-actions",      userActionsRoutes);

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("❌ Server error:", err.message);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// ── Startup checks ─────────────────────────────────────────────────────────────
const required = ["MONGODB_URI", "JWT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
const missing  = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required env vars: ${missing.join(", ")}`);
  console.error("   Check your .env file and restart.");
  process.exit(1);
}

// ── Connect MongoDB ────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    const db = mongoose.connection.name;
    console.log(`\n✅ MongoDB connected  →  database: "${db}"`);
    if (db === "test") {
      console.warn('⚠️  WARNING: Connected to "test" database — add /cohustle to your MONGODB_URI!');
    }
    console.log(`\n   Collections Mongoose will create automatically:`);
    console.log(`   ┌─────────────────────┬──────────────────────────────────────────┐`);
    console.log(`   │ users               │ Google OAuth users                       │`);
    console.log(`   │ startupprofiles     │ Startup name, industry, funding stage    │`);
    console.log(`   │ freelancerprofiles  │ Skills, bio, hourly rate, portfolio      │`);
    console.log(`   │ problems            │ Tasks posted by startups              │`);
    console.log(`   │ applications        │ Freelancer applications to problems      │`);
    console.log(`   │ conversations       │ 1-to-1 chat threads                      │`);
    console.log(`   │ messages            │ Individual chat messages                 │`);
    console.log(`   │ milestones          │ Project milestones                       │`);
    console.log(`   │ ratings             │ Post-collaboration star ratings          │`);
    console.log(`   │ collabrequests      │ S2S / collab request posts               │`);
    console.log(`   └─────────────────────┴──────────────────────────────────────────┘\n`);

    initSocket(httpServer);
    startChangeStreams();

    httpServer.listen(PORT, () => {
      console.log(`🚀 Backend running on   : http://localhost:${PORT}`);
      console.log(`   Health check         : http://localhost:${PORT}/api/health`);
      console.log(`   Google login URL     : http://localhost:${PORT}/api/auth/google`);
      console.log(`   Frontend allowed at  : ${allowedOrigins.join(", ")}\n`);
    });
  })
  .catch((err) => {
    console.error("\n❌ MongoDB connection FAILED:", err.message);
    console.error("   Things to check:");
    console.error("   1. Is your MONGODB_URI correct in .env?");
    console.error("   2. Did you whitelist 0.0.0.0/0 in Atlas Network Access?");
    console.error("   3. Is the username/password correct?\n");
    process.exit(1);
  });
