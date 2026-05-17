import express  from "express";
import jwt      from "jsonwebtoken";
import passport from "../config/passport.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });

// ── Step 1: Start Google login ─────────────────────────────────────────────────
// The key fix: prompt=select_account forces Google to ALWAYS show the
// account-picker screen, even if the user is already signed into one account.
// This lets users switch between different Gmail accounts.
router.get(
  "/google",
  passport.authenticate("google", {
    scope:  ["profile", "email"],
    session: false,
    prompt: "select_account",   // ← THIS is the fix for account switching
  })
);

// ── Step 2: Google callback ────────────────────────────────────────────────────
router.get(
  "/google/callback",
  passport.authenticate("google", {
    session:         false,
    failureRedirect: `${process.env.CLIENT_URL}/?error=auth_failed`,
  }),
  (req, res) => {
    const token = generateToken(req.user._id);
    res.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${token}`);
  }
);

// ── GET /api/auth/me ───────────────────────────────────────────────────────────
router.get("/me", authMiddleware, (req, res) => {
  res.json({
    id:        req.user._id,
    email:     req.user.email,
    fullName:  req.user.fullName,
    avatar:    req.user.avatar,
    role:      req.user.role,
    onboarded: req.user.onboarded,
    tags:      req.user.tags,
  });
});

// ── POST /api/auth/signout ─────────────────────────────────────────────────────
router.post("/signout", authMiddleware, (_req, res) => {
  res.json({ message: "Signed out successfully" });
});

export default router;
