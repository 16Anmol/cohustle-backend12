import express      from "express";
import suspendedCheck from "../middleware/suspendedCheck.js";
import mongoose     from "mongoose";
import authMiddleware from "../middleware/auth.js";
import Conversation from "../models/Conversation.js";
import Message      from "../models/Message.js";
import Application  from "../models/Application.js";
import User         from "../models/User.js";
import { emitToUser } from "../sockets/index.js";

const router = express.Router();

// Helper: find or create a conversation between two users (robust, no unique-index issues)
async function findOrCreateConversation(userId1, userId2) {
  const oid1 = new mongoose.Types.ObjectId(userId1.toString());
  const oid2 = new mongoose.Types.ObjectId(userId2.toString());

  // Find with $all (order-independent)
  let conv = await Conversation.findOne({ participants: { $all: [oid1, oid2], $size: 2 } });
  if (conv) return conv;

  // Not found — create with sorted IDs for consistency
  const sorted = [userId1.toString(), userId2.toString()].sort();
  try {
    conv = await Conversation.create({
      participants: sorted.map(id => new mongoose.Types.ObjectId(id))
    });
    return conv;
  } catch (e) {
    if (e.code === 11000) {
      // Duplicate key — another request created it simultaneously, fetch it
      return await Conversation.findOne({ participants: { $all: [oid1, oid2], $size: 2 } });
    }
    throw e;
  }
}

// ── GET /api/messages/conversations ───────────────────────────────────────────
router.get("/conversations", authMiddleware, async (req, res) => {
  try {
    const conversations = await Conversation.find({ participants: req.user._id })
      .sort({ lastMessageAt: -1 })
      .populate("participants", "fullName avatar role email")
      .lean();

    const enriched = await Promise.all(conversations.map(async (c) => {
      const other = c.participants.find(p => p._id.toString() !== req.user._id.toString());
      const unreadCount = await Message.countDocuments({
        conversationId: c._id, senderId: { $ne: req.user._id }, read: false,
      });
      return { ...c, otherUser: other, unreadCount };
    }));

    res.json({ conversations: enriched });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/messages/connections ─────────────────────────────────────────────
router.get("/connections", authMiddleware, async (req, res) => {
  try {
    const applications = await Application.find({
      $or: [{ startupUserId: req.user._id }, { freelancerUserId: req.user._id }],
      // Include ALL statuses — any application means a connection
      status: { $in: ["pending", "accepted", "selected", "finalised", "better_luck", "rejected"] },
    }).lean();

    if (!applications.length) return res.json({ connections: [] });

    const otherIds = [...new Set(applications.map(a => {
      return req.user._id.toString() === a.startupUserId.toString()
        ? a.freelancerUserId.toString()
        : a.startupUserId.toString();
    }))];

    const users = await User.find({ _id: { $in: otherIds } })
      .select("fullName avatar role email").lean();

    const enriched = users.map(u => {
      const relatedApps = applications.filter(a =>
        a.startupUserId.toString() === u._id.toString() ||
        a.freelancerUserId.toString() === u._id.toString()
      );
      return { ...u, connectionStatus: relatedApps[0]?.status, problemTitle: relatedApps[0]?.problemTitle };
    });

    res.json({ connections: enriched });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/messages/conversations ──────────────────────────────────────────
router.post("/conversations", authMiddleware, suspendedCheck, async (req, res) => {
  const { otherUserId } = req.body;
  if (!otherUserId) return res.status(400).json({ error: "otherUserId is required" });
  if (otherUserId === req.user._id.toString())
    return res.status(400).json({ error: "Cannot start a conversation with yourself" });

  try {
    const otherUser = await User.findById(otherUserId).select("fullName avatar role");
    if (!otherUser) return res.status(404).json({ error: "User not found" });

    // No gatekeeping — the frontend sidebar only shows valid connections anyway.
    // Any authenticated user can open a conversation with another user.

    const conversation = await findOrCreateConversation(req.user._id, otherUserId);
    if (!conversation) return res.status(500).json({ error: "Could not create conversation" });

    await conversation.populate("participants", "fullName avatar role email");
    const other = conversation.participants.find(
      p => p._id.toString() !== req.user._id.toString()
    );

    res.json({ ...conversation.toObject(), otherUser: other });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/messages/conversations/:id/messages ──────────────────────────────
router.get("/conversations/:id/messages", authMiddleware, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.user._id });
    if (!conversation) return res.status(404).json({ error: "Conversation not found or access denied" });

    const messages = await Message.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).lean();
    await Message.updateMany(
      { conversationId: conversation._id, senderId: { $ne: req.user._id }, read: false },
      { read: true }
    );
    res.json({ messages });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/messages/conversations/:id/messages ─────────────────────────────
router.post("/conversations/:id/messages", authMiddleware, suspendedCheck, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Content is required" });

  try {
    const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.user._id });
    if (!conversation) return res.status(404).json({ error: "Conversation not found or access denied" });

    const message = await Message.create({
      conversationId: conversation._id,
      senderId: req.user._id,
      content: content.trim(),
    });

    await Conversation.findByIdAndUpdate(conversation._id, {
      lastMessage: content.trim().slice(0, 100),
      lastMessageAt: new Date(),
    });

    const recipientId = conversation.participants
      .find(p => p.toString() !== req.user._id.toString())?.toString();

    if (recipientId) {
      emitToUser(recipientId, "message:received", {
        _id: message._id.toString(),
        conversationId: conversation._id.toString(),
        senderId: req.user._id.toString(),
        senderName: req.user.fullName,
        senderAvatar: req.user.avatar,
        content: message.content,
        read: false,
        createdAt: message.createdAt,
      });
      emitToUser(recipientId, "notification", {
        type: "message:new",
        title: `New message from ${req.user.fullName}`,
        message: content.trim().slice(0, 60),
        link: "/chat",
        createdAt: new Date().toISOString(),
      });
    }

    res.status(201).json(message);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/messages/unread-count ────────────────────────────────────────────
router.get("/unread-count", authMiddleware, async (req, res) => {
  try {
    const convos = await Conversation.find({ participants: req.user._id }).select("_id");
    const count  = await Message.countDocuments({
      conversationId: { $in: convos.map(c => c._id) },
      senderId: { $ne: req.user._id }, read: false,
    });
    res.json({ unreadCount: count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/messages/conversations/:id/schedule-meeting ─────────────────────
router.post("/conversations/:id/schedule-meeting", authMiddleware, suspendedCheck, async (req, res) => {
  const { date, timeSlot } = req.body;
  if (!date || !timeSlot) return res.status(400).json({ error: "date and timeSlot are required" });

  try {
    const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.user._id });
    if (!conversation) return res.status(404).json({ error: "Conversation not found or access denied" });

    const roomId    = Math.random().toString(36).substring(2, 8) + Date.now().toString(36).slice(-4);
    const clientUrl = process.env.CLIENT_URL || "http://localhost:8080";
    const joinLink  = `${clientUrl}/meet/${roomId}`;

    const meeting = { roomId, date, timeSlot, scheduledBy: req.user._id, joinLink, status: "upcoming" };
    conversation.meetings.push(meeting);
    await conversation.save();

    const savedMeeting = conversation.meetings[conversation.meetings.length - 1];

    const otherId = conversation.participants
      .find(p => p.toString() !== req.user._id.toString())?.toString();

    if (otherId) {
      emitToUser(otherId, "meeting:scheduled", {
        conversationId: conversation._id.toString(),
        meeting: savedMeeting,
        scheduledByName: req.user.fullName,
      });
      emitToUser(otherId, "notification", {
        type: "meeting:scheduled",
        title: "Meeting Scheduled 📅",
        message: `${req.user.fullName} scheduled a meeting on ${date} at ${timeSlot}`,
        link: "/chat",
        createdAt: new Date().toISOString(),
      });
    }

    res.json({ success: true, meeting: savedMeeting });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/messages/meetings/:roomId/end — end by roomId only (no conversationId needed) ───
router.patch("/meetings/:roomId/end", authMiddleware, async (req, res) => {
  try {
    // Find conversation containing this meeting
    const conversation = await Conversation.findOne({
      participants: req.user._id,
      "meetings.roomId": req.params.roomId,
    });
    if (!conversation) return res.status(404).json({ error: "Meeting not found" });

    const meeting = conversation.meetings.find(m => m.roomId === req.params.roomId);
    if (meeting) {
      meeting.status = "ended";
      await conversation.save();
    }

    // Notify all other participants via socket
    const otherIds = conversation.participants
      .filter(p => p.toString() !== req.user._id.toString())
      .map(p => p.toString());

    otherIds.forEach(uid => {
      emitToUser(uid, "meeting:ended", {
        conversationId: conversation._id.toString(),
        roomId: req.params.roomId,
      });
    });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/messages/conversations/:id/meetings/:roomId/end ───────────────
router.patch("/conversations/:id/meetings/:roomId/end", authMiddleware, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.user._id });
    if (!conversation) return res.status(404).json({ error: "Not found" });
    const meeting = conversation.meetings.find(m => m.roomId === req.params.roomId);
    if (meeting) {
      meeting.status = "ended";
      await conversation.save();
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/messages/conversations/:id/meetings ──────────────────────────────
router.get("/conversations/:id/meetings", authMiddleware, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.user._id });
    if (!conversation) return res.status(404).json({ error: "Conversation not found or access denied" });
    res.json({ meetings: conversation.meetings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
