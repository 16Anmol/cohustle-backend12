import express from "express";
import authMiddleware from "../middleware/auth.js";
import Milestone from "../models/Milestone.js";
import Application from "../models/Application.js";
import { emitToUser } from "../sockets/index.js";

const router = express.Router();

// ── Create milestone (startup only, on accepted application) ──────────────────
router.post("/", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup") {
    return res.status(403).json({ error: "Only startups can create milestones" });
  }

  const { applicationId, title, description, dueDate } = req.body;
  if (!applicationId || !title?.trim()) {
    return res.status(400).json({ error: "applicationId and title are required" });
  }

  try {
    // Allow milestones for any active application regardless of status
    const app = await Application.findOne({
      _id: applicationId,
      startupUserId: req.user._id,
      status: { $in: ["pending", "accepted", "selected", "finalised"] },
    });
    if (!app) {
      return res.status(404).json({ error: "Application not found or not yours" });
    }

    const milestone = await Milestone.create({
      problemId: app.problemId,
      applicationId: app._id,
      startupUserId: req.user._id,
      freelancerUserId: app.freelancerUserId,
      title: title.trim(),
      description: description || "",
      dueDate: dueDate ? new Date(dueDate) : undefined,
    });

    // Notify the freelancer
    emitToUser(app.freelancerUserId.toString(), "milestone:new", {
      id: milestone._id.toString(),
      title: milestone.title,
      problemId: milestone.problemId.toString(),
      dueDate: milestone.dueDate,
    });
    emitToUser(app.freelancerUserId.toString(), "notification", {
      type: "milestone:new",
      title: "New Milestone Added",
      message: `A new milestone "${milestone.title}" has been set for your project.`,
      link: `/freelancer/dashboard?tab=milestones`,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json(milestone);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get milestones for a specific application ─────────────────────────────────
router.get("/application/:applicationId", authMiddleware, async (req, res) => {
  try {
    const milestones = await Milestone.find({
      applicationId: req.params.applicationId,
      $or: [
        { startupUserId: req.user._id },
        { freelancerUserId: req.user._id },
      ],
    }).sort({ createdAt: 1 }).lean();
    res.json({ milestones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get all milestones for the logged-in user ─────────────────────────────────
router.get("/mine", authMiddleware, async (req, res) => {
  try {
    const filter = req.user.role === "startup"
      ? { startupUserId: req.user._id }
      : { freelancerUserId: req.user._id };

    const milestones = await Milestone.find(filter)
      .sort({ dueDate: 1, createdAt: 1 })
      .lean();
    res.json({ milestones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Update milestone status ───────────────────────────────────────────────────
router.patch("/:id/status", authMiddleware, async (req, res) => {
  const { status } = req.body;
  if (!["pending", "in_progress", "completed"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const milestone = await Milestone.findOne({
      _id: req.params.id,
      $or: [
        { startupUserId: req.user._id },
        { freelancerUserId: req.user._id },
      ],
    });
    if (!milestone) return res.status(404).json({ error: "Milestone not found" });

    milestone.status = status;
    if (status === "completed") milestone.completedAt = new Date();
    await milestone.save();

    // Notify the other party
    const notifyId = req.user.role === "startup"
      ? milestone.freelancerUserId.toString()
      : milestone.startupUserId.toString();

    emitToUser(notifyId, "milestone:updated", {
      id: milestone._id.toString(),
      title: milestone.title,
      status,
    });
    emitToUser(notifyId, "notification", {
      type: "milestone:updated",
      title: "Milestone Updated",
      message: `Milestone "${milestone.title}" marked as ${status}.`,
      link: req.user.role === "startup"
        ? `/freelancer/dashboard?tab=milestones`
        : `/startup/dashboard?tab=milestones`,
      createdAt: new Date().toISOString(),
    });

    res.json(milestone);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete milestone (startup only) ──────────────────────────────────────────
router.delete("/:id", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup") {
    return res.status(403).json({ error: "Only startups can delete milestones" });
  }
  try {
    const milestone = await Milestone.findOneAndDelete({
      _id: req.params.id,
      startupUserId: req.user._id,
    });
    if (!milestone) return res.status(404).json({ error: "Milestone not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
