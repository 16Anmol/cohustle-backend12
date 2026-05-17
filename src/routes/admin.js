import express from "express";
import User from "../models/User.js";
import Problem from "../models/Problem.js";
import Application from "../models/Application.js";
import Rating from "../models/Rating.js";
import CollabRequest from "../models/CollabRequest.js";
import Milestone from "../models/Milestone.js";
import StartupProfile    from "../models/StartupProfile.js";
import FreelancerProfile from "../models/FreelancerProfile.js";
import Report from "../models/Report.js";
import Announcement from "../models/Announcement.js";

const router = express.Router();

// ── Admin secret key guard ────────────────────────────────────────────────────
// The admin panel sends:  x-admin-key: <ADMIN_SECRET_KEY from .env>
// No JWT needed — completely separate from user auth.
const adminOnly = (req, res, next) => {
  const secret = process.env.ADMIN_SECRET_KEY;
  if (!secret) {
    return res.status(500).json({ error: "ADMIN_SECRET_KEY not set on server" });
  }
  const provided = req.headers["x-admin-key"];
  if (!provided || provided !== secret) {
    return res.status(403).json({ error: "Invalid admin key" });
  }
  next();
};

router.use(adminOnly);

// ── GET /admin/stats ──────────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const [
      totalUsers, startups, freelancers,
      totalProblems, openProblems,
      totalApplications, acceptedApplications,
      collabRequests, milestones, ratings,
      pendingVerifications, openReports, suspended,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "startup" }),
      User.countDocuments({ role: "freelancer" }),
      Problem.countDocuments(),
      Problem.countDocuments({ status: "open" }),
      Application.countDocuments(),
      Application.countDocuments({ status: { $in: ["accepted", "finalised"] } }),
      CollabRequest.countDocuments(),
      Milestone.countDocuments(),
      Rating.countDocuments(),
      User.countDocuments({ role: "startup", verificationStatus: "pending" }),
      Report.countDocuments({ status: "open" }),
      User.countDocuments({ suspended: true }),
    ]);

    // Also count users with missing docs (needs admin attention)
    // We do this with a pipeline to join profiles
    const [startupsMissingDocs, freelancersMissingDocs] = await Promise.all([
      StartupProfile.countDocuments({
        $or: [
          { identityProof:   { $in: [null, ""] } },
          { companyDocument: { $in: [null, ""] } },
        ],
      }),
      FreelancerProfile.countDocuments({
        $or: [
          { identityProof: { $in: [null, ""] } },
          { resumeLink:    { $in: [null, ""] } },
        ],
      }),
    ]);
    const usersWithMissingDocs = startupsMissingDocs + freelancersMissingDocs;

    res.json({
      stats: {
        totalUsers, startups, freelancers,
        totalProblems, openProblems,
        totalApplications, acceptedApplications,
        collabRequests, milestones, ratings,
        pendingVerifications, openReports, suspended,
        usersWithMissingDocs,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/users ──────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  try {
    const { role, search, suspended, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (suspended === "true") filter.suspended = true;
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email:    { $regex: search, $options: "i" } },
      ];
    }
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(Number(limit))
        .select("-__v -googleId").lean(),
      User.countDocuments(filter),
    ]);
    res.json({ users, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/users/:id ───────────────────────────────────────────────────
router.delete("/users/:id", async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /admin/users/:id/suspend ───────────────────────────────────────────
router.patch("/users/:id/suspend", async (req, res) => {
  try {
    const { suspended, reason = "" } = req.body;
    const update = suspended
      ? { suspended: true,  suspensionReason: reason.trim(), suspendedAt: new Date() }
      : { suspended: false, suspensionReason: "",            suspendedAt: null };

    const user = await User.findByIdAndUpdate(
      req.params.id, update, { new: true, select: "-__v -googleId" }
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/verifications ──────────────────────────────────────────────────
// Covers BOTH startups and freelancers.
// filter params:
//   role     = "startup" | "freelancer" | "" (both)
//   status   = "pending" | "approved" | "rejected" | "more_info" | "not_required" | "" (all)
//   docStatus = "missing" | "uploaded" | "all" (default "all")
router.get("/verifications", async (req, res) => {
  try {
    const { role, status, docStatus = "all", page = 1, limit = 30 } = req.query;

    // Build user filter — show ALL users who have a role set (onboarded or not)
    // We do NOT filter by onboarded so we catch everyone who registered but didn't finish
    const userFilter = {};
    if (role) {
      userFilter.role = role;
    } else {
      // Only show users who have picked a role (startup or freelancer), skip null-role users
      userFilter.role = { $in: ["startup", "freelancer"] };
    }

    // Status filter: "pending" means verificationStatus=pending
    // "not_required" is for freelancers who haven't gone through startup verification
    // "" or "all" = show everyone
    if (status && status !== "all") {
      userFilter.verificationStatus = status;
    }

    const [users, total] = await Promise.all([
      User.find(userFilter).sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(Number(limit))
        .select("-__v -googleId").lean(),
      User.countDocuments(userFilter),
    ]);

    const userIds = users.map(u => u._id);

    // Fetch both profile types in parallel
    const [startupProfiles, freelancerProfiles] = await Promise.all([
      StartupProfile.find({ userId: { $in: userIds } })
        .select("userId startupName industry fundingStage website companyDocument identityProof pitchDeck location teamSize description linkedinPage")
        .lean(),
      FreelancerProfile.find({ userId: { $in: userIds } })
        .select("userId bio skills experience portfolioLink hourlyRate githubLink linkedinLink location availability identityProof resumeLink")
        .lean(),
    ]);

    const startupMap = {};
    startupProfiles.forEach(p => { startupMap[p.userId.toString()] = p; });
    const freelancerMap = {};
    freelancerProfiles.forEach(p => { freelancerMap[p.userId.toString()] = p; });

    let result = users.map(u => {
      const id = u._id.toString();
      const profile = u.role === "startup"
        ? (startupMap[id] || null)
        : (freelancerMap[id] || null);

      // Compute document status
      let docsUploaded = 0, docsRequired = 0;
      if (u.role === "startup") {
        docsRequired = 2; // identityProof + companyDocument
        if (profile?.identityProof)  docsUploaded++;
        if (profile?.companyDocument) docsUploaded++;
      } else if (u.role === "freelancer") {
        docsRequired = 2; // identityProof + resumeLink
        if (profile?.identityProof) docsUploaded++;
        if (profile?.resumeLink)    docsUploaded++;
      }

      return {
        ...u,
        profile,
        docsUploaded,
        docsRequired,
        docsMissing: docsRequired - docsUploaded,
      };
    });

    // Apply docStatus filter after joining profiles
    if (docStatus === "missing") {
      result = result.filter(u => u.docsMissing > 0);
    } else if (docStatus === "uploaded") {
      result = result.filter(u => u.docsMissing === 0);
    }

    res.json({ verifications: result, total: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/verifications/:userId/approve ─────────────────────────────────
router.post("/verifications/:userId/approve", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { verificationStatus: "approved", verificationRejectionReason: "" },
      { new: true, select: "-__v -googleId" }
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/verifications/:userId/reject ──────────────────────────────────
router.post("/verifications/:userId/reject", async (req, res) => {
  try {
    const { reason = "" } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { verificationStatus: "rejected", verificationRejectionReason: reason },
      { new: true, select: "-__v -googleId" }
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/verifications/:userId/more-info ───────────────────────────────
router.post("/verifications/:userId/more-info", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { verificationStatus: "more_info" },
      { new: true, select: "-__v -googleId" }
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/problems ───────────────────────────────────────────────────────
router.get("/problems", async (req, res) => {
  try {
    const { status, search, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (search) filter.title = { $regex: search, $options: "i" };

    const [problems, total] = await Promise.all([
      Problem.find(filter).sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(Number(limit))
        .populate("startupUserId", "fullName email avatar").lean(),
      Problem.countDocuments(filter),
    ]);
    res.json({ problems, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/problems/:id ────────────────────────────────────────────────
router.delete("/problems/:id", async (req, res) => {
  try {
    await Problem.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/applications ───────────────────────────────────────────────────
router.get("/applications", async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const [applications, total] = await Promise.all([
      Application.find(filter).sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(Number(limit))
        .populate("startupUserId",    "fullName email avatar")
        .populate("freelancerUserId", "fullName email avatar").lean(),
      Application.countDocuments(filter),
    ]);
    res.json({ applications, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/collab-requests ────────────────────────────────────────────────
router.get("/collab-requests", async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const [collabs, total] = await Promise.all([
      CollabRequest.find(filter).sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(Number(limit))
        .populate("userId", "fullName email avatar role").lean(),
      CollabRequest.countDocuments(filter),
    ]);
    res.json({ collabRequests: collabs, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/collab-requests/:id ────────────────────────────────────────
router.delete("/collab-requests/:id", async (req, res) => {
  try {
    await CollabRequest.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/ratings ────────────────────────────────────────────────────────
router.get("/ratings", async (req, res) => {
  try {
    const ratings = await Rating.find().sort({ createdAt: -1 }).limit(50)
      .populate("reviewerId", "fullName email avatar")
      .populate("revieweeId", "fullName email avatar").lean();
    res.json({ ratings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/reports ────────────────────────────────────────────────────────
router.get("/reports", async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const [reports, total] = await Promise.all([
      Report.find(filter).sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(Number(limit))
        .populate("reporterUserId", "fullName email avatar role")
        .populate("reportedUserId", "fullName email avatar role").lean(),
      Report.countDocuments(filter),
    ]);
    res.json({ reports, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /admin/reports/:id ──────────────────────────────────────────────────
router.patch("/reports/:id", async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { ...(status && { status }), ...(adminNote && { adminNote }) },
      { new: true }
    )
      .populate("reporterUserId", "fullName email avatar role")
      .populate("reportedUserId", "fullName email avatar role").lean();
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json({ report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/announcements ──────────────────────────────────────────────────
router.get("/announcements", async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 }).limit(20).lean();
    res.json({ announcements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/announcements ─────────────────────────────────────────────────
router.post("/announcements", async (req, res) => {
  try {
    const { message, target = "all" } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: "Message required" });
    const announcement = await Announcement.create({ message: message.trim(), target });
    res.status(201).json({ announcement });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/analytics ──────────────────────────────────────────────────────
router.get("/analytics", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [signupsByDay, problemsByDay, verStats] = await Promise.all([
      User.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Problem.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      User.aggregate([
        { $match: { role: "startup" } },
        { $group: { _id: "$verificationStatus", count: { $sum: 1 } } },
      ]),
    ]);

    res.json({ signupsByDay, problemsByDay, verStats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/users/:id/profile ─────────────────────────────────────────────
// Returns the full user record + their startup OR freelancer profile
router.get("/users/:id/profile", async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-__v -googleId")
      .lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    let profile = null;
    if (user.role === "startup") {
      profile = await StartupProfile.findOne({ userId: user._id }).lean();
    } else if (user.role === "freelancer") {
      profile = await FreelancerProfile.findOne({ userId: user._id }).lean();
    }

    res.json({ user, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


export default router;
