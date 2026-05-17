# CoHustle — Backend Setup Guide

## Prerequisites
- Node.js 18+
- A MongoDB Atlas account (free tier is fine)
- A Google Cloud account (free)

---

## Step 1 — MongoDB Atlas Setup

1. Go to **https://cloud.mongodb.com** and sign in
2. Click **"Build a Database"** → choose **Free (M0)** → pick any region
3. Create a username and password (save these!)
4. Under **Network Access** → click **"Add IP Address"** → **"Allow access from anywhere"** (0.0.0.0/0)
5. Go to your cluster → click **"Connect"** → **"Drivers"**
6. Copy the connection string — it looks like:
   ```
   mongodb+srv://myuser:mypassword@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
7. In your `.env`, set:
   ```
   MONGODB_URI=mongodb+srv://myuser:mypassword@cluster0.xxxxx.mongodb.net/cohustle?retryWrites=true&w=majority
   ```
   > **The database name is `cohustle`** — add it between `.net/` and `?`

### Collections (Mongoose creates these automatically on first use)

| Collection | What it stores |
|---|---|
| `users` | Every person who signs in with Google |
| `startupprofiles` | Startup name, industry, funding stage, etc. |
| `freelancerprofiles` | Skills, bio, hourly rate, portfolio link |
| `problems` | Jobs/problems posted by startups |
| `applications` | Freelancer applications to problems |
| `conversations` | 1-to-1 chat threads |
| `messages` | Individual chat messages |
| `milestones` | Project milestones on accepted collaborations |
| `ratings` | Post-collaboration star ratings + comments |
| `collabrequests` | S2S and general "looking for" posts |

---

## Step 2 — Google OAuth Setup

1. Go to **https://console.cloud.google.com**
2. Create a new project (top left dropdown → "New Project")
3. Go to **APIs & Services → OAuth consent screen**
   - User type: **External**
   - Fill in App name: `CoHustle`, Support email: your Gmail
   - Click Save
4. Go to **APIs & Services → Credentials**
   - Click **"+ Create Credentials"** → **"OAuth 2.0 Client ID"**
   - Application type: **Web application**
   - Name: `CoHustle`
   - Under **"Authorized redirect URIs"** → click **"Add URI"**:
     ```
     http://localhost:5000/api/auth/google/callback
     ```
   - Click **Create**
5. Copy the **Client ID** and **Client Secret**
6. In your `.env`:
   ```
   GOOGLE_CLIENT_ID=123456789-abcdef.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxx
   ```

---

## Step 3 — Fill in .env

Open `.env` and fill in all 5 values:

```env
MONGODB_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/cohustle?retryWrites=true&w=majority
JWT_SECRET=any-long-random-string-60-chars-minimum
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
CLIENT_URL=http://localhost:5173
SERVER_URL=http://localhost:5000
PORT=5000
ADMIN_EMAILS=your-gmail@gmail.com
```

Generate a JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Step 4 — Run the Backend

```bash
npm install
npm run dev
```

You should see:
```
✅ MongoDB connected
   Database  : cohustle
   Collections (auto-created by Mongoose):
     users              — registered users (Google OAuth)
     startupprofiles    — startup onboarding data
     ...
🚀 Server running  : http://localhost:5000
   Health check    : http://localhost:5000/api/health
   Google login    : http://localhost:5000/api/auth/google
```

---

## How Google Login Works (end-to-end)

```
User clicks "Sign in with Google"
    ↓
Frontend: window.location.href = "http://localhost:5000/api/auth/google"
    ↓
Backend redirects to Google's consent screen
    ↓
User approves → Google sends code to callback URL
    ↓
Backend: /api/auth/google/callback
  → Verifies with Google
  → Creates user in MongoDB (or finds existing)
  → Generates JWT token
  → Redirects to: http://localhost:5173/auth/callback?token=JWT_HERE
    ↓
Frontend /auth/callback page:
  → Reads token from URL
  → Saves to localStorage as "cohustle_token"
  → Redirects to /select-role (new user) or /dashboard (returning user)
    ↓
Every subsequent API call sends: Authorization: Bearer JWT_HERE
```

---

## API Endpoints Reference

| Method | Endpoint | What it does |
|---|---|---|
| GET | `/api/health` | Server health check |
| GET | `/api/auth/google` | Start Google login |
| GET | `/api/auth/google/callback` | Google OAuth callback |
| GET | `/api/auth/me` | Get current user |
| POST | `/api/auth/signout` | Sign out |
| POST | `/api/profile/role` | Set role (startup/freelancer) |
| POST | `/api/profile/startup` | Save startup profile |
| PATCH | `/api/profile/startup` | Update startup profile |
| POST | `/api/profile/freelancer` | Save freelancer profile |
| PATCH | `/api/profile/freelancer` | Update freelancer profile |
| GET | `/api/profile/me` | Get full profile |
| GET | `/api/profile/matches` | Get tag-matched users |
| GET | `/api/problems` | List all open problems |
| POST | `/api/problems` | Post a problem (startup) |
| GET | `/api/problems/mine` | My posted problems |
| POST | `/api/problems/:id/apply` | Apply to a problem (freelancer) |
| GET | `/api/applications/mine` | My applications (freelancer) |
| GET | `/api/applications/received` | Received applications (startup) |
| PATCH | `/api/applications/:id/status` | Accept/reject application |
| GET | `/api/messages/conversations` | List conversations |
| POST | `/api/messages/conversations` | Start a conversation |
| GET | `/api/messages/conversations/:id/messages` | Get messages |
| POST | `/api/messages/conversations/:id/messages` | Send a message |
| POST | `/api/milestones` | Create milestone (startup) |
| GET | `/api/milestones/mine` | My milestones |
| PATCH | `/api/milestones/:id/status` | Update milestone status |
| POST | `/api/ratings` | Submit a rating |
| GET | `/api/ratings/mine` | My received ratings |
| POST | `/api/collab-requests` | Post S2S collab request |
| GET | `/api/collab-requests` | Browse collab requests |
| GET | `/api/admin/stats` | Platform stats (admin only) |
| GET | `/api/admin/users` | All users (admin only) |

## WebRTC Signaling Server

A separate Python WebSocket server handles video call signaling.

### Setup
```bash
# Install Python deps
pip install -r webrtc_requirements.txt

# Run the signaling server (port 8765)
python webrtc_server.py
```

The signaling server runs on `ws://localhost:8765` by default.
Set `VITE_WEBRTC_WS_URL` in the frontend `.env` to point to it.

## IMPORTANT: Database Migration Required

If you have an existing `conversations` collection with a unique index on `participants`, drop it:

```bash
# In MongoDB shell or Atlas
db.conversations.dropIndex("participants_1")
```

This is required for the conversation creation to work correctly.
