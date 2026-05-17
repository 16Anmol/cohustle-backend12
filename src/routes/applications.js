import express from "express";
import authMiddleware from "../middleware/auth.js";
import Application from "../models/Application.js";
import Problem from "../models/Problem.js";
import { emitToUser } from "../sockets/index.js";

const router = express.Router();

// ── GET /api/applications/mine  (freelancer) ───────────────────────────────────
router.get("/mine", authMiddleware, async (req, res) => {
  if (req.user.role !== "freelancer")
    return res.status(403).json({ error: "Only freelancers can access this" });
  try {
    const applications = await Application.find({ freelancerUserId: req.user._id })
      .sort({ createdAt: -1 }).lean();
    res.json({ applications });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/applications/received  (startup – all their apps) ─────────────────
router.get("/received", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup")
    return res.status(403).json({ error: "Only startup accounts can access this" });
  try {
    const applications = await Application.find({ startupUserId: req.user._id })
      .sort({ createdAt: -1 }).lean();
    res.json({ applications });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/applications/by-problem/:problemId  (startup – per task) ──────────
// Returns all applications for a task regardless of task status (open, closed, etc.)
router.get("/by-problem/:problemId", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup")
    return res.status(403).json({ error: "Only startup accounts can access this" });
  try {
    // Verify problem belongs to this startup (any status — even closed tasks show applicants)
    const problem = await Problem.findOne({ _id: req.params.problemId, startupUserId: req.user._id });
    if (!problem) return res.status(404).json({ error: "Task not found or not yours" });

    const applications = await Application.find({ problemId: req.params.problemId })
      .sort({ createdAt: -1 }).lean();
    res.json({ applications });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/applications/:id/status ────────────────────────────────────────
// All allowed statuses + finalisation guard (only one finalised per problem)
router.patch("/:id/status", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup")
    return res.status(403).json({ error: "Only startups can update application status" });

  const { status } = req.body;
  const allowed = ["pending", "selected", "finalised", "better_luck", "accepted", "rejected"];
  if (!allowed.includes(status))
    return res.status(400).json({ error: `Status must be one of: ${allowed.join(", ")}` });

  try {
    const application = await Application.findOne({ _id: req.params.id, startupUserId: req.user._id });
    if (!application) return res.status(404).json({ error: "Application not found or not yours" });

    // Guard: only one finalised per problem
    if (status === "finalised") {
      const existing = await Application.findOne({
        problemId: application.problemId,
        status: "finalised",
        _id: { $ne: application._id },
      });
      if (existing) {
        return res.status(400).json({
          error: "A freelancer is already finalised for this task. Undo that first.",
        });
      }
    }

    application.status = status;
    await application.save();

    // Notify freelancer (skip on internal moves like pending)
    const notifyStatuses = { selected: "selected", finalised: "finalised", better_luck: "better_luck" };
    if (notifyStatuses[status]) {
      const msgs = {
        selected:    `Great news! You've been selected for "${application.problemTitle}" 🎉`,
        finalised:   `You are the finalised freelancer for "${application.problemTitle}" 🚀`,
        better_luck: `Thank you for applying to "${application.problemTitle}". Better luck next time!`,
      };
      emitToUser(application.freelancerUserId.toString(), "application:status", {
        applicationId: application._id.toString(),
        problemId:     application.problemId.toString(),
        problemTitle:  application.problemTitle,
        status,
      });
      emitToUser(application.freelancerUserId.toString(), "notification", {
        type:      "application:status",
        title:     status === "better_luck" ? "Application Update" : "Application Update 🎉",
        message:   msgs[status],
        link:      `/freelancer/dashboard?tab=applications`,
        createdAt: new Date().toISOString(),
      });
    }

    res.json({ success: true, application });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/applications/:id/bulk-status  (bulk actions on a problem) ───────
router.patch("/bulk-status", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup")
    return res.status(403).json({ error: "Only startups can do bulk actions" });

  const { problemId, newStatus, excludeIds = [] } = req.body;
  if (!problemId || !newStatus) return res.status(400).json({ error: "problemId and newStatus required" });

  try {
    const problem = await Problem.findOne({ _id: problemId, startupUserId: req.user._id });
    if (!problem) return res.status(404).json({ error: "Task not found or not yours" });

    const filter = {
      problemId,
      startupUserId: req.user._id,
      status: { $nin: ["finalised"] },  // never touch finalised
    };
    if (excludeIds.length) filter._id = { $nin: excludeIds };

    await Application.updateMany(filter, { status: newStatus });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/applications/:id/schedule-meeting ────────────────────────────────
router.post("/:id/schedule-meeting", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup")
    return res.status(403).json({ error: "Only startups can schedule meetings" });

  const { date, timeSlot } = req.body;
  if (!date || !timeSlot) return res.status(400).json({ error: "date and timeSlot required" });

  try {
    const application = await Application.findOne({ _id: req.params.id, startupUserId: req.user._id });
    if (!application) return res.status(404).json({ error: "Application not found" });

    // Generate a WebRTC room ID — frontend routes to /meet/:roomId
    const meetingId = Math.random().toString(36).substring(2, 10) + Date.now().toString(36).slice(-4);
    const clientUrl = process.env.CLIENT_URL || "http://localhost:8080";
    const link = `${clientUrl}/meet/${meetingId}`;

    application.meeting = { date, timeSlot, link, scheduled: true };
    await application.save();

    // Notify the freelancer
    emitToUser(application.freelancerUserId.toString(), "notification", {
      type:      "meeting:scheduled",
      title:     "Meeting Scheduled 📅",
      message:   `${req.user.fullName} has scheduled a meeting with you on ${date} at ${timeSlot}.`,
      link:      `/freelancer/dashboard?tab=applications`,
      createdAt: new Date().toISOString(),
    });

    res.json({ success: true, meeting: application.meeting });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/applications/:id ─────────────────────────────────────────────────
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const application = await Application.findById(req.params.id).lean();
    if (!application) return res.status(404).json({ error: "Application not found" });
    if (
      application.startupUserId.toString() !== req.user._id.toString() &&
      application.freelancerUserId.toString() !== req.user._id.toString()
    ) return res.status(403).json({ error: "Access denied" });
    res.json(application);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
