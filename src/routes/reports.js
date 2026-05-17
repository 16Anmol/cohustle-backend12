import express from "express";
import authMiddleware from "../middleware/auth.js";
import Report from "../models/Report.js";

const router = express.Router();

// POST /api/reports — any logged-in user can file a report
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { reportedUserId, reason, description } = req.body;
    if (!reportedUserId || !reason) {
      return res.status(400).json({ error: "reportedUserId and reason are required" });
    }
    if (reportedUserId === req.user._id.toString()) {
      return res.status(400).json({ error: "Cannot report yourself" });
    }
    const report = await Report.create({
      reporterUserId: req.user._id,
      reportedUserId,
      reason,
      description: description || "",
    });
    res.status(201).json({ report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
