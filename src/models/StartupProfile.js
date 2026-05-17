import mongoose from "mongoose";

const startupProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    startupName:        { type: String, required: true },
    industry:           { type: String },
    description:        { type: String },
    fundingStage:       { type: String },
    website:            { type: String },
    location:           { type: String },
    teamSize:           { type: String },
    linkedinPage:       { type: String },
    // Verification documents (Google Drive links)
    companyDocument:    { type: String },  // Registration cert / GST / incorporation doc
    identityProof:      { type: String },  // Founder ID proof (Aadhaar / Passport / PAN)
    pitchDeck:          { type: String },  // Optional pitch deck
  },
  { timestamps: true },
);

export default mongoose.model("StartupProfile", startupProfileSchema);
