import mongoose from "mongoose";

const milestoneSchema = new mongoose.Schema(
  {
    problemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Problem",
      required: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
    },
    startupUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    freelancerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    dueDate: { type: Date },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed"],
      default: "pending",
    },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

milestoneSchema.index({ problemId: 1 });
milestoneSchema.index({ applicationId: 1 });
milestoneSchema.index({ startupUserId: 1 });
milestoneSchema.index({ freelancerUserId: 1 });

export default mongoose.model("Milestone", milestoneSchema);
