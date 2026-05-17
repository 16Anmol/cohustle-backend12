import mongoose from "mongoose";

const applicationSchema = new mongoose.Schema(
  {
    problemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Problem",
      required: true,
    },
    problemTitle:     { type: String, required: true },
    startupUserId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    freelancerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    applicantName:    { type: String, required: true },

    // ── Proposal fields ───────────────────────────────────────────────────────
    pitch:           { type: String, default: "" },     // MANDATORY - their solution explanation
    coverNote:       { type: String, default: "" },     // alias / backward-compat
    skills:          { type: [String], default: [] },
    pastProjects:    { type: String, default: "" },
    resumeLink:      { type: String, default: "" },     // PDF link (mandatory)
    portfolioLink:   { type: String, default: "" },     // kept for backward compat
    githubLink:      { type: String, default: "" },     // optional
    linkedinLink:    { type: String, default: "" },     // optional
    deliveryTimeline:{ type: String, default: "" },
    expectedBudget:  { type: String, default: "" },

    // ── Status ────────────────────────────────────────────────────────────────
    // "pending"          → default, under review
    // "selected"         → startup chose this freelancer (only one per problem)
    // "finalised"        → startup confirmed & locked this freelancer for the task
    // "better_luck"      → replaces "rejected" — polite decline
    status: {
      type: String,
      enum: ["pending", "selected", "finalised", "better_luck", "accepted", "rejected"],
      default: "pending",
    },

    // ── Meeting scheduler ─────────────────────────────────────────────────────
    meeting: {
      date:      { type: String, default: "" },
      timeSlot:  { type: String, default: "" },
      link:      { type: String, default: "" },
      scheduled: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

applicationSchema.index({ problemId: 1, freelancerUserId: 1 }, { unique: true });
applicationSchema.index({ startupUserId: 1, status: 1 });
applicationSchema.index({ freelancerUserId: 1, status: 1 });
applicationSchema.index({ problemId: 1, status: 1 });

export default mongoose.model("Application", applicationSchema);
