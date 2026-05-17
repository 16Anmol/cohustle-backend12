import "dotenv/config";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/User.js";

passport.use(
  new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  `${process.env.SERVER_URL || "http://localhost:5000"}/api/auth/google/callback`,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email:    profile.emails[0].value,
            fullName: profile.displayName,
            avatar:   profile.photos?.[0]?.value || null,
          });
          console.log(`✅ New user created: ${user.email}`);
        } else {
          user.avatar = profile.photos?.[0]?.value || user.avatar;
          await user.save();
          console.log(`✅ User logged in: ${user.email}`);
        }

        return done(null, user);
      } catch (err) {
        console.error("❌ Google OAuth error:", err.message);
        return done(err, null);
      }
    }
  )
);

export default passport;
