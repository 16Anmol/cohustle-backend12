import mongoose from "mongoose";

const meetingSchema = new mongoose.Schema({
  roomId:      { type: String, required: true },
  date:        { type: String, required: true },   // ISO date string "2026-04-25"
  timeSlot:    { type: String, required: true },   // "10:30 AM"
  scheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  scheduledAt: { type: Date, default: Date.now },
  joinLink:    { type: String },                   // /meet/:roomId
  status:      { type: String, enum: ["upcoming", "active", "ended"], default: "upcoming" },
}, { _id: false });

const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      validate: {
        validator: (arr) => arr.length === 2,
        message: "Conversation must have exactly 2 participants",
      },
    },
    lastMessage:   { type: String, default: "" },
    lastMessageAt: { type: Date, default: Date.now },
    meetings:      { type: [meetingSchema], default: [] },
  },
  { timestamps: true },
);

// Sort participants before every save so order is always deterministic
// This means [A,B] and [B,A] both get stored as the same sorted order
conversationSchema.pre("save", function(next) {
  if (this.isNew && this.participants && this.participants.length === 2) {
    this.participants.sort((a, b) => a.toString().localeCompare(b.toString()));
  }
  next();
});

// Non-unique index for lookup performance only
// Uniqueness is enforced in application logic (findOrCreateConversation helper)
conversationSchema.index({ participants: 1 }); // non-unique

export default mongoose.model("Conversation", conversationSchema);
