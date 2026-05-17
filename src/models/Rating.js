import mongoose from "mongoose";

const ratingSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: false,
      default: null,
    },
    problemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Problem",
      required: false,
      default: null,
    },
    // who gave the rating
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // who received the rating
    revieweeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

// One rating per reviewer per reviewee
ratingSchema.index({ reviewerId: 1, revieweeId: 1 }, { unique: true });
ratingSchema.index({ revieweeId: 1 });

export default mongoose.model("Rating", ratingSchema);
