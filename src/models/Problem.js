import mongoose from "mongoose";

const problemSchema = new mongoose.Schema(
  {
    startupUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title:       { type: String, required: true, trim: true },
    description: { type: String, required: true },
    tags:        { type: [String], default: [] },
    budget:      { type: String, default: "" },     // display string e.g. "₹5,000 - ₹10,000"
    budgetMin:   { type: Number, default: null },   // numeric for filtering
    budgetMax:   { type: Number, default: null },   // numeric for filtering
    timeline:    { type: String, default: "" },
    location:    { type: String, default: "" },     // city/state e.g. "Amritsar, Punjab"
    status: {
      type: String,
      enum: ["open", "in_progress", "closed"],
      default: "open",
    },
    applicationCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

problemSchema.index({ tags: 1 });
problemSchema.index({ status: 1, createdAt: -1 });
problemSchema.index({ startupUserId: 1 });
problemSchema.index({ location: 1 });
problemSchema.index({ budgetMin: 1, budgetMax: 1 });

export default mongoose.model("Problem", problemSchema);
