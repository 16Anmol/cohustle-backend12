import mongoose from "mongoose";

const blockSchema = new mongoose.Schema(
  {
    blockerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    blockedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// One user can only block another once
blockSchema.index({ blockerUserId: 1, blockedUserId: 1 }, { unique: true });
blockSchema.index({ blockerUserId: 1 });
blockSchema.index({ blockedUserId: 1 });

export default mongoose.model("Block", blockSchema);
