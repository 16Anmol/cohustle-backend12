import express from "express";
import suspendedCheck from "../middleware/suspendedCheck.js";
import authMiddleware from "../middleware/auth.js";
import CollabPitch   from "../models/CollabPitch.js";
import CollabRequest from "../models/CollabRequest.js";
import Message      from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import User         from "../models/User.js";
import { emitToUser } from "../sockets/index.js";

const router = express.Router();

// ── POST /api/collab-pitches — submit a pitch to a collab post ────────────────
router.post("/", authMiddleware, suspendedCheck, async (req, res) => {
  if (req.user.role !== "startup")
    return res.status(403).json({ error: "Only startups can pitch" });

  const { collabRequestId, startupName, tagline, sector, stage, teamSize, location,
          whatYouOffer, yourTech, pastWins, collabGoal, collabType, yourAsk, timeline,
          website, linkedin, demoLink } = req.body;

  if (!collabRequestId) return res.status(400).json({ error: "collabRequestId is required" });

  try {
    const collabPost = await CollabRequest.findById(collabRequestId);
    if (!collabPost) return res.status(404).json({ error: "Collab post not found" });

    if (collabPost.userId.toString() === req.user._id.toString())
      return res.status(400).json({ error: "Cannot pitch to your own collab post" });

    // Check if already pitched
    const existing = await CollabPitch.findOne({ collabRequestId, pitcherUserId: req.user._id });
    if (existing) return res.status(409).json({ error: "You have already pitched to this post" });

    const pitch = await CollabPitch.create({
      collabRequestId,
      collabPostTitle: collabPost.title,
      receiverUserId:  collabPost.userId,
      pitcherUserId:   req.user._id,
      pitcherName:     req.user.fullName,
      startupName, tagline, sector, stage, teamSize, location,
      whatYouOffer, yourTech: yourTech || [], pastWins,
      collabGoal, collabType, yourAsk, timeline,
      website, linkedin, demoLink,
    });

    // Notify the post owner
    emitToUser(collabPost.userId.toString(), "notification", {
      type:      "collab:pitch",
      title:     "New Collaboration Pitch! 🚀",
      message:   `${req.user.fullName} pitched to your post "${collabPost.title}"`,
      link:      `/collab-pitches/${collabRequestId}`,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ pitch });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "Already pitched to this post" });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/collab-pitches/for/:collabRequestId — all pitches for a post ─────
router.get("/for/:collabRequestId", authMiddleware, async (req, res) => {
  try {
    // Verify the requester owns the collab post
    const post = await CollabRequest.findOne({ _id: req.params.collabRequestId, userId: req.user._id });
    if (!post) return res.status(403).json({ error: "Not found or not yours" });

    const pitches = await CollabPitch.find({ collabRequestId: req.params.collabRequestId })
      .sort({ createdAt: -1 }).lean();

    res.json({ pitches, postTitle: post.title });
  } catch (err) {
    // Handle CastError (invalid ObjectId format)
    if (err.name === "CastError") return res.status(400).json({ error: "Invalid ID" });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/collab-pitches/mine — pitches I sent ─────────────────────────────
router.get("/mine", authMiddleware, async (req, res) => {
  try {
    const pitches = await CollabPitch.find({ pitcherUserId: req.user._id })
      .sort({ createdAt: -1 }).lean();
    res.json({ pitches });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/collab-pitches/:id — get a single pitch ─────────────────────────
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const pitch = await CollabPitch.findById(req.params.id).lean();
    if (!pitch) return res.status(404).json({ error: "Pitch not found" });
    // Must be pitcher or receiver
    const uid = req.user._id.toString();
    if (pitch.pitcherUserId.toString() !== uid && pitch.receiverUserId.toString() !== uid) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.json({ pitch });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/collab-pitches/:id/connect — mark as connected ─────────────────
router.patch("/:id/connect", authMiddleware, async (req, res) => {
  try {
    const pitch = await CollabPitch.findOne({ _id: req.params.id, receiverUserId: req.user._id });
    if (!pitch) return res.status(404).json({ error: "Pitch not found or not yours" });

    pitch.status = "connected";
    await pitch.save();

    // Notify the pitcher
    emitToUser(pitch.pitcherUserId.toString(), "notification", {
      type:      "collab:connected",
      title:     "Collaboration Connected! 🤝",
      message:   `Your pitch to "${pitch.collabPostTitle}" was accepted! You can now chat.`,
      link:      "/chat",
      createdAt: new Date().toISOString(),
    });

    res.json({ success: true, pitch });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ── POST /api/collab-pitches/migrate-from-chat ───────────────────────────────
// One-time migration: scan chat messages for old pitch messages and save as CollabPitch records
// This makes old pitches (sent before the new system) appear on the pitches page
router.post("/migrate-from-chat", authMiddleware, async (req, res) => {
  try {
    // Find all messages that look like pitches
    const pitchMessages = await Message.find({
      content: { $regex: "Startup Collaboration Pitch from", $options: "i" }
    }).lean();

    let created = 0;
    let skipped = 0;

    for (const msg of pitchMessages) {
      // Get the conversation to find participants
      const convo = await Conversation.findById(msg.conversationId).lean();
      if (!convo || convo.participants.length !== 2) { skipped++; continue; }

      const pitcherUserId  = msg.senderId;
      const receiverUserId = convo.participants.find(p => p.toString() !== pitcherUserId.toString());
      if (!receiverUserId) { skipped++; continue; }

      // Find a collab post owned by receiver (any open post)
      const collabPost = await CollabRequest.findOne({ userId: receiverUserId }).lean();
      if (!collabPost) { skipped++; continue; }

      // Parse pitch data from message content
      const content = msg.content;
      const get = (label) => {
        const match = content.match(new RegExp(`${label}[:\s]+([^\n*]+)`));
        return match ? match[1].trim().replace(/\*\*/g, "").trim() : "";
      };

      // Parse startup name: find text after "Pitch from " up to **
      const pitchFromIdx = content.indexOf("Pitch from ");
      const startupName = pitchFromIdx >= 0
        ? content.slice(pitchFromIdx + 11).split("**")[0].trim()
        : "";
      // Parse tagline: find text after "About us" marker
      const aboutIdx = content.indexOf("**About us**");
      const tagline = aboutIdx >= 0
        ? content.slice(aboutIdx + 12).split("\n").filter(l => l.trim())[0]?.trim() || ""
        : "";

      // Check if already migrated
      const exists = await CollabPitch.findOne({
        collabRequestId: collabPost._id, pitcherUserId
      });
      if (exists) { skipped++; continue; }

      const pitcher = await User.findById(pitcherUserId).lean();

      try {
        await CollabPitch.create({
          collabRequestId: collabPost._id,
          collabPostTitle: collabPost.title,
          receiverUserId,
          pitcherUserId,
          pitcherName:   pitcher?.fullName || "Unknown",
          startupName:   startupName || pitcher?.fullName || "",
          tagline:       tagline || "",
          sector:        get("Sector"),
          stage:         get("Stage"),
          teamSize:      get("Team"),
          location:      get("Location"),
          whatYouOffer:  (() => {
            const idx = content.indexOf("What we bring");
            if (idx < 0) return get("Skills");
            return content.slice(idx).split("\n").filter(l => l.trim() && !l.startsWith("**"))[0]?.trim() || get("Skills");
          })(),
          collabGoal:    get("Goal"),
          collabType:    get("Type"),
          yourAsk:       get("What we need") || "",
          timeline:      get("Timeline"),
        });
        created++;
      } catch (e) {
        if (e.code !== 11000) console.error("Migration error:", e.message);
        else skipped++;
      }
    }

    res.json({ success: true, created, skipped, total: pitchMessages.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
