import mongoose from "mongoose";
import { emitToAll, emitToRole, emitToUser } from "../sockets/index.js";

/**
 * MongoDB Change Streams — push real-time events via Socket.io.
 *
 * IMPORTANT: Change Streams require a MongoDB REPLICA SET.
 * - MongoDB Atlas: works out of the box (all Atlas clusters are replica sets)
 * - Local MongoDB: you need to run it as a replica set OR just skip this
 *   and real-time updates will still work via the Socket.io emits in each route.
 *
 * If you see "MongoServerError: $changeStream stage is only allowed for replica sets"
 * → your local MongoDB is standalone. Either use Atlas, or remove this call from index.js.
 */
export const startChangeStreams = () => {
  // Give mongoose connection a moment to be fully ready
  const conn = mongoose.connection;

  try {
    // ── Watch users collection ─────────────────────────────────────────────────
    const profileStream = conn
      .collection("users")
      .watch([{ $match: { operationType: { $in: ["update", "replace"] } } }], {
        fullDocument: "updateLookup",
      });

    profileStream.on("change", (change) => {
      const doc = change.fullDocument;
      if (!doc) return;
      emitToUser(doc._id.toString(), "profile:updated", {
        id: doc._id.toString(),
        fullName: doc.fullName,
        role: doc.role,
        onboarded: doc.onboarded,
        avatar: doc.avatar,
      });
    });

    profileStream.on("error", (err) => {
      // Silently handle — routes still emit events directly
      console.warn("⚠️  Profile change stream unavailable:", err.message);
    });

    // ── Watch problems collection ──────────────────────────────────────────────
    const problemStream = conn
      .collection("problems")
      .watch([{ $match: { operationType: "insert" } }], {
        fullDocument: "updateLookup",
      });

    problemStream.on("change", (change) => {
      const doc = change.fullDocument;
      if (!doc) return;
      emitToRole("freelancer", "problem:new", {
        id: doc._id.toString(),
        title: doc.title,
        tags: doc.tags,
        budget: doc.budget,
        description: doc.description,
        postedAt: doc.createdAt,
      });
      emitToAll("explore:problem:new", {
        id: doc._id.toString(),
        title: doc.title,
        tags: doc.tags,
        budget: doc.budget,
        description: doc.description,
      });
    });

    problemStream.on("error", (err) => {
      console.warn("⚠️  Problem change stream unavailable:", err.message);
    });

    // ── Watch applications collection ──────────────────────────────────────────
    const applicationStream = conn
      .collection("applications")
      .watch([{ $match: { operationType: "insert" } }], {
        fullDocument: "updateLookup",
      });

    applicationStream.on("change", (change) => {
      const doc = change.fullDocument;
      if (!doc) return;
      emitToUser(doc.startupUserId.toString(), "application:new", {
        id: doc._id.toString(),
        problemId: doc.problemId.toString(),
        problemTitle: doc.problemTitle,
        applicantName: doc.applicantName,
        applicantId: doc.freelancerUserId.toString(),
        appliedAt: doc.createdAt,
      });
      emitToUser(doc.startupUserId.toString(), "notification", {
        type: "application:new",
        title: "New Application",
        message: `${doc.applicantName} applied to "${doc.problemTitle}"`,
        link: `/startup/dashboard?tab=applications`,
        createdAt: new Date().toISOString(),
      });
    });

    applicationStream.on("error", (err) => {
      console.warn("⚠️  Application change stream unavailable:", err.message);
    });

    // ── Watch application status updates ───────────────────────────────────────
    const appUpdateStream = conn
      .collection("applications")
      .watch(
        [{ $match: { operationType: "update", "updateDescription.updatedFields.status": { $exists: true } } }],
        { fullDocument: "updateLookup" }
      );

    appUpdateStream.on("change", (change) => {
      const doc = change.fullDocument;
      if (!doc) return;
      const msgs = {
        accepted: `Your application for "${doc.problemTitle}" was accepted! 🎉`,
        rejected: `Your application for "${doc.problemTitle}" was not selected this time.`,
      };
      const msg = msgs[doc.status];
      if (!msg) return;

      emitToUser(doc.freelancerUserId.toString(), "application:status", {
        applicationId: doc._id.toString(),
        problemId: doc.problemId.toString(),
        problemTitle: doc.problemTitle,
        status: doc.status,
      });
      emitToUser(doc.freelancerUserId.toString(), "notification", {
        type: "application:status",
        title: doc.status === "accepted" ? "Application Accepted! 🎉" : "Application Update",
        message: msg,
        link: `/freelancer/dashboard?tab=applications`,
        createdAt: new Date().toISOString(),
      });
    });

    appUpdateStream.on("error", (err) => {
      console.warn("⚠️  App update change stream unavailable:", err.message);
    });

    console.log("✅ MongoDB Change Streams active: users, problems, applications");
  } catch (err) {
    console.warn("⚠️  Change Streams not available (requires replica set). Real-time events still work via route emits.");
  }
};
