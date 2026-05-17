import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    reporterUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reportedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reason: {
      type: String,
      enum: [
        "fake_project",
        "abusive_behavior",
        "spam",
        "ghosting",
        "fraud",
        "other",
      ],
      required: true,
    },
    description: { type: String, default: "" },
    screenshotUrl: { type: String, default: "" }, // optional Google Drive link
    status: {
      type: String,
      enum: ["open", "resolved", "dismissed"],
      default: "open",
    },
    adminNote: { type: String, default: "" },
  },
  { timestamps: true },
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reportedUserId: 1 });

export default mongoose.model("Report", reportSchema);
