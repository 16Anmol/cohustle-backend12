import express from "express";
import authMiddleware from "../middleware/auth.js";
import Report from "../models/Report.js";
import Block  from "../models/Block.js";
import User   from "../models/User.js";

const router = express.Router();

// ── POST /api/user-actions/report ─────────────────────────────────────────────
// Any logged-in user can report another user
router.post("/report", authMiddleware, async (req, res) => {
  try {
    const { reportedUserId, reason, description = "", screenshotUrl = "" } = req.body;

    if (!reportedUserId || !reason) {
      return res.status(400).json({ error: "reportedUserId and reason are required" });
    }
    if (reportedUserId === req.user._id.toString()) {
      return res.status(400).json({ error: "You cannot report yourself" });
    }

    const reported = await User.findById(reportedUserId).select("_id").lean();
    if (!reported) return res.status(404).json({ error: "User not found" });

    // Prevent duplicate reports by same reporter for same user
    const existing = await Report.findOne({
      reporterUserId: req.user._id,
      reportedUserId,
      status: "open",
    });
    if (existing) {
      return res.status(409).json({ error: "You already have an open report against this user" });
    }

    const report = await Report.create({
      reporterUserId: req.user._id,
      reportedUserId,
      reason,
      description: description.trim(),
      screenshotUrl: screenshotUrl.trim(),
    });

    res.status(201).json({ report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/user-actions/block ──────────────────────────────────────────────
// Block a user — they become invisible to each other
router.post("/block", authMiddleware, async (req, res) => {
  try {
    const { blockedUserId } = req.body;

    if (!blockedUserId) return res.status(400).json({ error: "blockedUserId required" });
    if (blockedUserId === req.user._id.toString()) {
      return res.status(400).json({ error: "You cannot block yourself" });
    }

    const target = await User.findById(blockedUserId).select("_id fullName avatar role").lean();
    if (!target) return res.status(404).json({ error: "User not found" });

    // Upsert — silently succeed if already blocked
    await Block.findOneAndUpdate(
      { blockerUserId: req.user._id, blockedUserId },
      { blockerUserId: req.user._id, blockedUserId },
      { upsert: true, new: true }
    );

    res.json({ success: true, blockedUser: target });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/user-actions/block/:userId ────────────────────────────────────
// Unblock a user
router.delete("/block/:userId", authMiddleware, async (req, res) => {
  try {
    await Block.findOneAndDelete({
      blockerUserId: req.user._id,
      blockedUserId: req.params.userId,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/user-actions/blocked ─────────────────────────────────────────────
// Get all users I have blocked
router.get("/blocked", authMiddleware, async (req, res) => {
  try {
    const blocks = await Block.find({ blockerUserId: req.user._id })
      .sort({ createdAt: -1 })
      .populate("blockedUserId", "fullName email avatar role")
      .lean();

    const blocked = blocks.map(b => b.blockedUserId).filter(Boolean);
    res.json({ blocked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/user-actions/block-status/:userId ────────────────────────────────
// Check if I blocked this user or they blocked me
router.get("/block-status/:userId", authMiddleware, async (req, res) => {
  try {
    const [iBlocked, theyBlocked] = await Promise.all([
      Block.findOne({ blockerUserId: req.user._id,       blockedUserId: req.params.userId }),
      Block.findOne({ blockerUserId: req.params.userId,  blockedUserId: req.user._id }),
    ]);
    res.json({ iBlocked: !!iBlocked, theyBlocked: !!theyBlocked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
