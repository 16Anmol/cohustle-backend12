import mongoose from "mongoose";

// Startup-to-Startup (S2S) and general collaboration requests
const collabRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    lookingFor: {
      type: String,
      enum: ["startup", "freelancer", "co-founder", "mentor", "investor"],
      required: true,
    },
    tags: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
    },
  },
  { timestamps: true }
);

collabRequestSchema.index({ userId: 1 });
collabRequestSchema.index({ tags: 1 });
collabRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("CollabRequest", collabRequestSchema);
