import express from "express";
import authMiddleware from "../middleware/auth.js";
import User from "../models/User.js";
import StartupProfile from "../models/StartupProfile.js";
import FreelancerProfile from "../models/FreelancerProfile.js";
import Block             from "../models/Block.js";
import Problem from "../models/Problem.js";
import CollabRequest from "../models/CollabRequest.js";

const router = express.Router();

// ── POST /api/profile/role ─────────────────────────────────────────────────────
// Called once from SelectRole page after Google login
router.post("/role", authMiddleware, async (req, res) => {
  const { role } = req.body;

  if (!["startup", "freelancer"].includes(role)) {
    return res.status(400).json({ error: "Role must be startup or freelancer" });
  }
  if (req.user.role) {
    return res.status(400).json({ error: "Role already set" });
  }

  req.user.role = role;
  await req.user.save();
  res.json({ role });
});

// ── POST /api/profile/startup ──────────────────────────────────────────────────
// Called from SelectRole step 3 (startup form) — saves startup profile
router.post("/startup", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup") {
    return res.status(403).json({ error: "Only startup accounts can use this route" });
  }

  const {
    startupName, industry, description, fundingStage, website, location, tags,
    teamSize, linkedinPage, companyDocument, identityProof, pitchDeck
  } = req.body;

  if (!startupName?.trim()) {
    return res.status(400).json({ error: "Startup name is required" });
  }
  if (tags && tags.length > 15) {
    return res.status(400).json({ error: "Maximum 15 tags allowed" });
  }

  try {
    const existing = await StartupProfile.findOne({ userId: req.user._id });
    if (existing) {
      // If profile exists, update it with new fields (handles re-onboarding)
      await StartupProfile.findOneAndUpdate({ userId: req.user._id }, {
        startupName: startupName.trim(),
        industry: industry || "",
        description: description || "",
        fundingStage: fundingStage || "",
        website: website || "",
        location: location || "",
        teamSize: teamSize || "",
        linkedinPage: linkedinPage || "",
        ...(companyDocument !== undefined && { companyDocument }),
        ...(identityProof !== undefined && { identityProof }),
        ...(pitchDeck !== undefined && { pitchDeck }),
      });
      req.user.tags = tags || [];
      req.user.onboarded = true;
      if (req.user.verificationStatus === "not_required") {
        req.user.verificationStatus = "pending";
      }
      await req.user.save();
      return res.json({ success: true });
    }

    await StartupProfile.create({
      userId: req.user._id,
      startupName: startupName.trim(),
      industry: industry || "",
      description: description || "",
      fundingStage: fundingStage || "",
      website: website || "",
      location: location || "",
      teamSize: teamSize || "",
      linkedinPage: linkedinPage || "",
      companyDocument: companyDocument || "",
      identityProof: identityProof || "",
      pitchDeck: pitchDeck || "",
    });

    req.user.tags = tags || [];
    req.user.onboarded = true;
    if (req.user.verificationStatus === "not_required") {
      req.user.verificationStatus = "pending";
    }
    await req.user.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/profile/startup ─────────────────────────────────────────────────
// Update existing startup profile
router.patch("/startup", authMiddleware, async (req, res) => {
  if (req.user.role !== "startup") {
    return res.status(403).json({ error: "Only startup accounts can use this route" });
  }

  const {
    startupName, industry, description, fundingStage, website, location, tags,
    teamSize, linkedinPage, companyDocument, identityProof, pitchDeck
  } = req.body;

  try {
    const profile = await StartupProfile.findOneAndUpdate(
      { userId: req.user._id },
      {
        ...(startupName && { startupName: startupName.trim() }),
        ...(industry !== undefined && { industry }),
        ...(description !== undefined && { description }),
        ...(fundingStage !== undefined && { fundingStage }),
        ...(website !== undefined && { website }),
        ...(location !== undefined && { location }),
        ...(teamSize !== undefined && { teamSize }),
        ...(linkedinPage !== undefined && { linkedinPage }),
        ...(companyDocument !== undefined && { companyDocument }),
        ...(identityProof !== undefined && { identityProof }),
        ...(pitchDeck !== undefined && { pitchDeck }),
      },
      { new: true, upsert: false }
    );

    if (!profile) return res.status(404).json({ error: "Profile not found" });

    if (tags !== undefined) {
      req.user.tags = tags.slice(0, 15);
      await req.user.save();
    }

    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/profile/freelancer ───────────────────────────────────────────────
// Called from SelectRole step 3 (freelancer form)
router.post("/freelancer", authMiddleware, async (req, res) => {
  if (req.user.role !== "freelancer") {
    return res.status(403).json({ error: "Only freelancer accounts can use this route" });
  }

  const { skills, experience, portfolioLink, hourlyRate, bio, tags } = req.body;

  if (!skills?.length) {
    return res.status(400).json({ error: "At least one skill is required" });
  }
  if (tags && tags.length > 15) {
    return res.status(400).json({ error: "Maximum 15 tags allowed" });
  }

  try {
    const existing = await FreelancerProfile.findOne({ userId: req.user._id });
    if (existing) {
      return res.status(400).json({ error: "Profile already exists. Use PATCH to update." });
    }

    await FreelancerProfile.create({
      userId: req.user._id,
      skills,
      experience: experience || "",
      portfolioLink: portfolioLink || "",
      hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null,
      bio: bio || "",
    });

    req.user.tags = tags || [];
    req.user.onboarded = true;
    await req.user.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/profile/freelancer ──────────────────────────────────────────────
// Update existing freelancer profile
router.patch("/freelancer", authMiddleware, async (req, res) => {
  if (req.user.role !== "freelancer") {
    return res.status(403).json({ error: "Only freelancer accounts can use this route" });
  }

  const {
    skills, experience, portfolioLink, hourlyRate, bio, tags,
    githubLink, linkedinLink, location, availability, identityProof, resumeLink
  } = req.body;

  try {
    const profile = await FreelancerProfile.findOneAndUpdate(
      { userId: req.user._id },
      {
        ...(skills && { skills }),
        ...(experience !== undefined && { experience }),
        ...(portfolioLink !== undefined && { portfolioLink }),
        ...(hourlyRate !== undefined && { hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null }),
        ...(bio !== undefined && { bio }),
        ...(githubLink !== undefined && { githubLink }),
        ...(linkedinLink !== undefined && { linkedinLink }),
        ...(location !== undefined && { location }),
        ...(availability !== undefined && { availability }),
        ...(identityProof !== undefined && { identityProof }),
        ...(resumeLink !== undefined && { resumeLink }),
      },
      { new: true, upsert: false }
    );

    if (!profile) return res.status(404).json({ error: "Profile not found" });

    if (tags !== undefined) {
      req.user.tags = tags.slice(0, 15);
      await req.user.save();
    }

    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/profile/me ────────────────────────────────────────────────────────
// Returns user + their role-specific profile — called by frontend AuthContext
router.get("/me", authMiddleware, async (req, res) => {
  // Always include suspension + verification fields so frontend can react
  const base = {
    id:                 req.user._id,
    email:              req.user.email,
    fullName:           req.user.fullName,
    avatar:             req.user.avatar,
    role:               req.user.role,
    onboarded:          req.user.onboarded,
    tags:               req.user.tags,
    suspended:          req.user.suspended          ?? false,
    suspensionReason:   req.user.suspensionReason   ?? "",
    suspendedAt:        req.user.suspendedAt        ?? null,
    verificationStatus: req.user.verificationStatus ?? "not_required",
    verificationRejectionReason: req.user.verificationRejectionReason ?? "",
  };

  if (req.user.role === "startup") {
    const startup = await StartupProfile.findOne({ userId: req.user._id }).lean();
    return res.json({ ...base, startupProfile: startup });
  }

  if (req.user.role === "freelancer") {
    const freelancer = await FreelancerProfile.findOne({ userId: req.user._id }).lean();
    return res.json({ ...base, freelancerProfile: freelancer });
  }

  res.json(base);
});

// ── GET /api/profile/matches ───────────────────────────────────────────────────
// Tag-based matching: startups see freelancers, freelancers see startups
router.get("/matches", authMiddleware, async (req, res) => {
  if (!req.user.tags?.length) {
    return res.json({ matches: [], message: "Add tags to your profile to see matches" });
  }

  const targetRole = req.user.role === "startup" ? "freelancer" : "startup";

  // Get block lists — exclude users I blocked and users who blocked me
  const [iBlocked, theyBlocked] = await Promise.all([
    Block.find({ blockerUserId: req.user._id }).distinct("blockedUserId"),
    Block.find({ blockedUserId: req.user._id }).distinct("blockerUserId"),
  ]);
  const blockedIds = [...new Set([...iBlocked, ...theyBlocked].map(id => id.toString()))];

  const matches = await User.aggregate([
    {
      $match: {
        role: targetRole,
        onboarded: true,
        tags: { $in: req.user.tags },
      },
    },
    {
      $addFields: {
        sharedTagCount: {
          $size: {
            $filter: {
              input: "$tags",
              as: "tag",
              cond: { $in: ["$$tag", req.user.tags] },
            },
          },
        },
      },
    },
    { $sort: { sharedTagCount: -1 } },
    { $limit: 20 },
    { $project: { _id: 1, fullName: 1, avatar: 1, tags: 1, sharedTagCount: 1 } },
  ]);

  const enriched = await Promise.all(
    matches.map(async (u) => {
      const profile =
        targetRole === "startup"
          ? await StartupProfile.findOne({ userId: u._id }).lean()
          : await FreelancerProfile.findOne({ userId: u._id }).lean();
      return { ...u, profile };
    })
  );

  res.json({ matches: enriched });
});

// ── PATCH /api/profile/tags ────────────────────────────────────────────────────
router.patch("/tags", authMiddleware, async (req, res) => {
  const { tags } = req.body;
  if (!Array.isArray(tags)) return res.status(400).json({ error: "Tags must be an array" });
  if (tags.length > 15) return res.status(400).json({ error: "Maximum 15 tags allowed" });

  req.user.tags = tags.map((t) => t.toLowerCase().trim()).filter(Boolean);
  await req.user.save();
  res.json({ tags: req.user.tags });
});



// ── PATCH /api/profile/documents ─────────────────────────────────────────────
// Lets a user upload/update their document links at any time (e.g. after suspension)
router.patch("/documents", authMiddleware, async (req, res) => {
  try {
    if (req.user.role === "startup") {
      const { identityProof, companyDocument, pitchDeck } = req.body;
      const update = {};
      if (identityProof  !== undefined) update.identityProof   = identityProof;
      if (companyDocument!== undefined) update.companyDocument = companyDocument;
      if (pitchDeck      !== undefined) update.pitchDeck       = pitchDeck;

      const profile = await StartupProfile.findOneAndUpdate(
        { userId: req.user._id },
        { $set: update },
        { new: true, upsert: true }
      );
      return res.json({ profile });

    } else if (req.user.role === "freelancer") {
      const { identityProof, resumeLink } = req.body;
      const update = {};
      if (identityProof !== undefined) update.identityProof = identityProof;
      if (resumeLink    !== undefined) update.resumeLink    = resumeLink;

      const profile = await FreelancerProfile.findOneAndUpdate(
        { userId: req.user._id },
        { $set: update },
        { new: true, upsert: true }
      );
      return res.json({ profile });

    } else {
      return res.status(400).json({ error: "Role not set" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/profile/:userId — public profile view ──────────────────────────────
router.get("/:userId", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select("fullName email role avatar tags createdAt suspended suspensionReason suspendedAt verificationStatus").lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    let profile = null;
    let tasks = [];
    let collabPosts = [];

    if (user.role === "startup") {
      profile = await StartupProfile.findOne({ userId: req.params.userId }).lean();

      // Suspended startups: hide their active listings from other users
      if (!user.suspended) {
        tasks = await Problem.find({ startupUserId: req.params.userId, status: "open" })
          .sort({ createdAt: -1 }).limit(6)
          .select("title description tags budget timeline applicationCount createdAt").lean();
        collabPosts = await CollabRequest.find({ userId: req.params.userId, status: "open" })
          .sort({ createdAt: -1 }).limit(4)
          .select("title description tags lookingFor createdAt").lean();
      }
    } else if (user.role === "freelancer") {
      profile = await FreelancerProfile.findOne({ userId: req.params.userId }).lean();
      // Remove hourlyRate from public view
      if (profile) {
        const { hourlyRate, ...publicProfile } = profile;
        profile = publicProfile;
      }
    }

    res.json({ user, profile, tasks, collabPosts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
