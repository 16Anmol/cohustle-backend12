import express from "express";
import Block from "../models/Block.js";
import suspendedCheck from "../middleware/suspendedCheck.js";
import authMiddleware from "../middleware/auth.js";
import Problem from "../models/Problem.js";
import Application from "../models/Application.js";
import { emitToUser, emitToRole, emitToAll } from "../sockets/index.js";

const router = express.Router();

// ── POST /api/problems ────────────────────────────────────────────────────────
router.post("/", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup") {
    return res.status(403).json({ error: "Only startup accounts can post tasks" });
  }

  const { title, description, tags, budget, budgetMin, budgetMax, timeline, location } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Task title is required" });
  if (!description?.trim()) return res.status(400).json({ error: "Description is required" });

  try {
    const problem = await Problem.create({
      startupUserId: req.user._id,
      title:       title.trim(),
      description: description.trim(),
      tags:        tags || [],
      budget:      budget || "",
      budgetMin:   budgetMin ? Number(budgetMin) : null,
      budgetMax:   budgetMax ? Number(budgetMax) : null,
      timeline:    timeline || "",
      location:    location || "",
    });

    emitToRole("freelancer", "problem:new", {
      id: problem._id.toString(), title: problem.title,
      tags: problem.tags, budget: problem.budget,
      description: problem.description, postedAt: problem.createdAt,
    });
    emitToAll("explore:problem:new", {
      id: problem._id.toString(), title: problem.title,
      tags: problem.tags, budget: problem.budget, description: problem.description,
    });

    res.status(201).json(problem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/problems ─────────────────────────────────────────────────────────
router.get("/", async (req, res) => {  // Public — guests can browse tasks
  try {
    const {
      tags, search,
      sortBy    = "newest",
      timeline,
      location,
      budgetMin, budgetMax,
      dateFrom, dateTo,      // ISO date strings
      page = 1, limit = 30,
    } = req.query;

    // If logged in, exclude posts from users they blocked or who blocked them
    let blockedIds = [];
    const token = req.headers.authorization?.split(" ")[1];
    if (token) {
      try {
        const jwt = await import("jsonwebtoken");
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
        const [iBlocked, theyBlocked] = await Promise.all([
          Block.find({ blockerUserId: decoded.id }).distinct("blockedUserId"),
          Block.find({ blockedUserId: decoded.id }).distinct("blockerUserId"),
        ]);
        blockedIds = [...new Set([...iBlocked, ...theyBlocked].map(id => id.toString()))];
      } catch {} // not logged in or invalid token — ignore
    }

    const filter = { status: "open" };
    if (blockedIds.length > 0) {
      filter.startupUserId = { $nin: blockedIds };
    }

    // Use $and array so all filters can coexist without conflicts
    const andConditions = [];

    // Text search (title, description, tags, location) - wrapped in $and so it doesn't clash
    if (search && search.trim()) {
      andConditions.push({
        $or: [
          { title:       { $regex: search.trim(), $options: "i" } },
          { description: { $regex: search.trim(), $options: "i" } },
          { tags:        { $regex: search.trim(), $options: "i" } },
          { location:    { $regex: search.trim(), $options: "i" } },
        ]
      });
    }

    // Tag filter — exact match against stored tags array
    if (tags) {
      const tagArray = tags.split(",").map(t => t.trim()).filter(Boolean);
      if (tagArray.length) {
        andConditions.push({ tags: { $in: tagArray } });
      }
    }

    // Timeline filter
    if (timeline && timeline.trim()) {
      andConditions.push({ timeline: { $regex: timeline.trim(), $options: "i" } });
    }

    // Location filter
    if (location && location.trim()) {
      andConditions.push({ location: { $regex: location.trim(), $options: "i" } });
    }

    // Budget range
    if (budgetMin) {
      andConditions.push({
        $or: [{ budgetMax: { $gte: Number(budgetMin) } }, { budgetMax: null }]
      });
    }
    if (budgetMax) {
      andConditions.push({
        $or: [{ budgetMin: { $lte: Number(budgetMax) } }, { budgetMin: null }]
      });
    }

    // Date posted range
    if (dateFrom || dateTo) {
      const dateFilter = {};
      if (dateFrom) dateFilter.$gte = new Date(dateFrom);
      if (dateTo)   dateFilter.$lte = new Date(dateTo + "T23:59:59.999Z");
      andConditions.push({ createdAt: dateFilter });
    }

    if (andConditions.length > 0) {
      filter.$and = andConditions;
    }

    // Sort
    const sortMap = {
      newest:            { createdAt: -1 },
      oldest:            { createdAt: 1 },
      most_applications: { applicationCount: -1 },
      budget_high:       { budgetMax: -1 },
      budget_low:        { budgetMin: 1 },
    };
    const sort = sortMap[sortBy] || sortMap.newest;

    const problems = await Problem.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate("startupUserId", "fullName avatar")
      .lean();

    const total = await Problem.countDocuments(filter);

    // Distinct values for filter dropdowns
    const [allTags, allLocations] = await Promise.all([
      Problem.distinct("tags",     { status: "open" }),
      Problem.distinct("location", { status: "open", location: { $ne: "" } }),
    ]);

    res.json({ problems, total, page: Number(page), limit: Number(limit), allTags, allLocations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/problems/mine ────────────────────────────────────────────────────
router.get("/mine", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup")
    return res.status(403).json({ error: "Only startup accounts can access this" });
  try {
    const problems = await Problem.find({ startupUserId: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ problems });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/problems/:id ─────────────────────────────────────────────────────
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const problem = await Problem.findById(req.params.id).populate("startupUserId", "fullName avatar").lean();
    if (!problem) return res.status(404).json({ error: "Task not found" });
    res.json(problem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/problems/:id/status ───────────────────────────────────────────
router.patch("/:id/status", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup")
    return res.status(403).json({ error: "Only startup accounts can update problems" });
  const { status } = req.body;
  if (!["open", "in_progress", "closed"].includes(status))
    return res.status(400).json({ error: "Invalid status" });
  try {
    const problem = await Problem.findOneAndUpdate(
      { _id: req.params.id, startupUserId: req.user._id },
      { status }, { new: true }
    );
    if (!problem) return res.status(404).json({ error: "Task not found" });
    res.json(problem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/problems/:id/apply ──────────────────────────────────────────────
router.post("/:id/apply", authMiddleware, suspendedCheck, async (req, res) => {
  if (req.user.role !== "freelancer")
    return res.status(403).json({ error: "Only freelancers can apply to problems" });

  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) return res.status(404).json({ error: "Task not found" });
    if (problem.status !== "open")
      return res.status(400).json({ error: "This task is no longer accepting applications" });

    const {
      pitch, coverNote, skills, pastProjects,
      resumeLink, githubLink, linkedinLink, portfolioLink,
      deliveryTimeline, expectedBudget
    } = req.body;

    // Mandatory fields
    const pitchText = pitch?.trim() || coverNote?.trim();
    if (!pitchText)    return res.status(400).json({ error: "Pitch / solution is required" });
    if (!resumeLink?.trim()) return res.status(400).json({ error: "Resume link (PDF) is required" });

    const application = await Application.create({
      problemId:        problem._id,
      problemTitle:     problem.title,
      startupUserId:    problem.startupUserId,
      freelancerUserId: req.user._id,
      applicantName:    req.user.fullName,
      pitch:            pitchText,
      coverNote:        pitchText,           // keep backward-compat
      skills:           skills || [],
      pastProjects:     pastProjects || "",
      resumeLink:       resumeLink.trim(),
      githubLink:       githubLink?.trim() || "",
      linkedinLink:     linkedinLink?.trim() || "",
      portfolioLink:    portfolioLink?.trim() || "",
      deliveryTimeline: deliveryTimeline || "",
      expectedBudget:   expectedBudget || "",
    });

    await Problem.findByIdAndUpdate(problem._id, { $inc: { applicationCount: 1 } });

    // Send the FULL application object so the dashboard can display it immediately
    emitToUser(problem.startupUserId.toString(), "application:new", {
      _id:              application._id.toString(),
      problemId:        problem._id.toString(),
      problemTitle:     problem.title,
      startupUserId:    problem.startupUserId.toString(),
      freelancerUserId: req.user._id.toString(),
      applicantName:    req.user.fullName,
      pitch:            application.pitch,
      coverNote:        application.coverNote,
      skills:           application.skills,
      pastProjects:     application.pastProjects,
      resumeLink:       application.resumeLink,
      githubLink:       application.githubLink,
      linkedinLink:     application.linkedinLink,
      portfolioLink:    application.portfolioLink,
      deliveryTimeline: application.deliveryTimeline,
      expectedBudget:   application.expectedBudget,
      status:           "pending",
      createdAt:        application.createdAt,
    });
    emitToUser(problem.startupUserId.toString(), "notification", {
      type: "application:new", title: "New Application",
      message: `${req.user.fullName} applied to task: "${problem.title}"`,
      link: `/startup/dashboard?tab=applications`,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ success: true, applicationId: application._id });
  } catch (err) {
    if (err.code === 11000)
      return res.status(400).json({ error: "You have already applied to this problem" });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/problems/:id/applications ───────────────────────────────────────
router.get("/:id/applications", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup")
    return res.status(403).json({ error: "Only startup accounts can view applications" });
  try {
    const problem = await Problem.findOne({ _id: req.params.id, startupUserId: req.user._id });
    if (!problem) return res.status(404).json({ error: "Task not found" });
    const applications = await Application.find({ problemId: problem._id }).sort({ createdAt: -1 }).lean();
    res.json({ applications });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
