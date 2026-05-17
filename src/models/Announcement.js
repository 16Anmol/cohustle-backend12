import mongoose from "mongoose";

const announcementSchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    target: {
      type: String,
      enum: ["all", "startup", "freelancer"],
      default: "all",
    },
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

export default mongoose.model("Announcement", announcementSchema);
