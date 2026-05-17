import mongoose from "mongoose";

const freelancerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    skills:          [{ type: String }],
    experience:      { type: String },
    portfolioLink:   { type: String },
    hourlyRate:      { type: Number },
    bio:             { type: String },
    githubLink:      { type: String },
    linkedinLink:    { type: String },
    location:        { type: String },
    availability:    { type: String },  // e.g. "Full-time", "Part-time", "Weekends"
    // Verification documents (Google Drive links)
    identityProof:   { type: String },  // Aadhaar / Passport / PAN
    resumeLink:      { type: String },  // Professional resume / CV
  },
  { timestamps: true },
);

export default mongoose.model("FreelancerProfile", freelancerProfileSchema);
