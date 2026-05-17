import mongoose from "mongoose";

// A startup pitching to another startup's CollabRequest
const collabPitchSchema = new mongoose.Schema(
  {
    collabRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "CollabRequest", required: true },
    collabPostTitle: { type: String, required: true },
    // The startup who posted the collab request (receiver)
    receiverUserId:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // The startup pitching (sender)
    pitcherUserId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    pitcherName:     { type: String, required: true },

    // Pitch details (from PitchDialog steps)
    startupName:     { type: String, default: "" },
    tagline:         { type: String, default: "" },
    sector:          { type: String, default: "" },
    stage:           { type: String, default: "" },
    teamSize:        { type: String, default: "" },
    location:        { type: String, default: "" },
    whatYouOffer:    { type: String, default: "" },
    yourTech:        { type: [String], default: [] },
    pastWins:        { type: String, default: "" },
    collabGoal:      { type: String, default: "" },
    collabType:      { type: String, default: "" },
    yourAsk:         { type: String, default: "" },
    timeline:        { type: String, default: "" },
    website:         { type: String, default: "" },
    linkedin:        { type: String, default: "" },
    demoLink:        { type: String, default: "" },

    // Status — no reject, just pending or connected
    status: {
      type: String,
      enum: ["pending", "connected"],
      default: "pending",
    },
  },
  { timestamps: true }
);

collabPitchSchema.index({ collabRequestId: 1, pitcherUserId: 1 }, { unique: true });
collabPitchSchema.index({ receiverUserId: 1 });
collabPitchSchema.index({ pitcherUserId: 1 });

export default mongoose.model("CollabPitch", collabPitchSchema);
