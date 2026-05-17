import express from "express";
import authMiddleware from "../middleware/auth.js";
import CollabRequest from "../models/CollabRequest.js";

const router = express.Router();

// ── Create a collab request ───────────────────────────────────────────────────
router.post("/", authMiddleware, async (req, res) => {
  const { title, description, lookingFor, tags } = req.body;
  if (!title?.trim() || !description?.trim() || !lookingFor) {
    return res.status(400).json({ error: "title, description, and lookingFor are required" });
  }

  try {
    const collab = await CollabRequest.create({
      userId: req.user._id,
      title: title.trim(),
      description: description.trim(),
      lookingFor,
      tags: tags || [],
    });
    res.status(201).json(collab);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get all open collab requests (paginated) ──────────────────────────────────
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { lookingFor, page = 1, limit = 20 } = req.query;
    const filter = { status: "open" };
    if (lookingFor) filter.lookingFor = lookingFor;

    const requests = await CollabRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate("userId", "fullName avatar role tags")
      .lean();

    const total = await CollabRequest.countDocuments(filter);
    res.json({ requests, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get my collab requests ────────────────────────────────────────────────────
router.get("/mine", authMiddleware, async (req, res) => {
  try {
    const requests = await CollabRequest.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete / close a collab request ──────────────────────────────────────────
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const collab = await CollabRequest.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!collab) return res.status(404).json({ error: "Request not found or not yours" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
