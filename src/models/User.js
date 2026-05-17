import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true },
    email:    { type: String, required: true, unique: true },
    fullName: { type: String },
    avatar:   { type: String },
    role:     { type: String, enum: ["startup", "freelancer"], default: null },
    onboarded:{ type: Boolean, default: false },

    // Startup account verification by admin
    verificationStatus: {
      type: String,
      enum: ["not_required", "pending", "approved", "rejected", "more_info"],
      default: "not_required",
    },
    verificationRejectionReason: { type: String, default: "" },

    // Admin suspension
    suspended:         { type: Boolean, default: false },
    suspensionReason:  { type: String,  default: "" },
    suspendedAt:       { type: Date,    default: null },

    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 15,
        message: "Maximum 15 tags allowed",
      },
    },
  },
  { timestamps: true },
);

userSchema.index({ tags: 1 });
userSchema.index({ role: 1, tags: 1 });
userSchema.index({ verificationStatus: 1 });

export default mongoose.model("User", userSchema);
