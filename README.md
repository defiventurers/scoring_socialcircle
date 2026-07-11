# The Social Circle - Mixed Pickleball Social Scoring App

A highly responsive, mobile-first Progressive Web Application (PWA) designed for courtside referees and tournament directors running mixed-doubles pickleball socials.

This application runs natively on modern mobile browsers (iOS Safari, Android Chrome) and desktops. It features a complete dual-mode engine:
1. **Local Demo Mode (Default):** Boots instantly with offline localStorage databases, enabling quick validation, demo-scoring, and immediate iframe preview testing in AI Studio without needing custom cloud infrastructure.
2. **Firebase Realtime Database Mode:** Promoted automatically upon configuring a valid `firebase-config.js` with Firebase Auth, live sync listeners, and security access controls.

---

## 🏸 TOURNAMENT SPECIFICATIONS

The tournament operates under the official Social Circle social parameters:
* **Courts:** 4 active courts running concurrent matches.
* **Match Capacity:** 20 rounds of mixed doubles, totalling exactly 80 scheduled matches (20 matches per court).
* **Format:** Mixed doubles play.
* **Scoring Rules (Rally Scoring):** 
  * Every single rally awards 1 point, regardless of who serves.
  * Matches are a **Race to 15** points (Win by 1 is enforced; no win-by-two margins required).
  * Tied scores are prohibited upon final match submission.
* **Service Rotation Rules (TT Service Rule):**
  * Service is strictly dependent on the overall sum of scores.
  * Team A serves for 2 points, then Team B serves for 2 points, regardless of who wins each rally.
  * This repeats continuously: A, A, B, B, A, A, B, B.
  * Calculated automatically: `Math.floor((ScoreA + ScoreB) / 2) % 2 === 0` implies Team A serves, otherwise Team B.
* **8-Minute Time Limit Rule:**
  * Referees start an optional 8-minute countdown timer per match.
  * Upon "TIME UP", the referee allows the ongoing rally to finish.
  * If one team is leading, they may finalize the current score.
  * If tied, referees must direct the players to play **one deciding rally** (Ties are prohibited).

---

## 🛠️ FILE STRUCTURE

The application is written in elegant, high-contrast, vanilla HTML5, CSS3, and modern JavaScript, with zero reliance on complex compile bundlers:

* **`index.html`:** Layout containing the multi-view tab structures (Score, Matches, Standings, Rules, Admin) with safe notch margins and notch boundaries (`viewport-fit=cover`).
* **`styles.css`:** Tailored CSS using Space Grotesk display headings, Inter UI components, rich brushed-gold, dark forest greens, and navy accents. Features a multi-pane split layout on desktop and single-view drawers on mobile.
* **`app.js`:** The core operational engine. Houses the state managers, timer counters, speech synthesizers, local storage caches, and Firebase SDK listeners.
* **`fixtures.js`:** Static dataset seeding all 80 official matches for courts 1, 2, 3, and 4.
* **`firebase-config.js`:** Configuration credentials.
* **`database.rules.json`:** JSON structure detailing access controls and data locks for the Realtime Database.
* **`manifest.json` & `service-worker.js`:** PWA scripts enabling instant offline capabilities and homescreen installations.

---

## 🔑 AUTHENTICATION & PIN MAP

Referees select their assigned Court Card (1-4) on the homescreen, then enter their 4-digit PIN. The app translates the court number internally into Firebase accounts:

| Role / Court | Login Email | Local PIN Tip | Firebase Password |
| :--- | :--- | :--- | :--- |
| **Court 1** | `court1@socialcircle.app` | `1111` or `2026` | Custom (Set in Console) |
| **Court 2** | `court2@socialcircle.app` | `2222` or `2026` | Custom (Set in Console) |
| **Court 3** | `court3@socialcircle.app` | `3333` or `2026` | Custom (Set in Console) |
| **Court 4** | `court4@socialcircle.app` | `4444` or `2026` | Custom (Set in Console) |
| **Admin** | `admin@socialcircle.app` | `9999` or `2026` | Custom (Set in Console) |

---

## 🚀 CLOUD PROVISIONING & DEPLOYMENT

To take this application live in production, follow these steps to hook up Firebase:

### 1. Create a Firebase Project
1. Visit the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add Project** and name it (e.g., `mixed-pickleball-social`).
3. Under **Authentication**, enable the **Email/Password** sign-in provider.
4. Add the 5 referee and administrator user accounts listed in the Authentication PIN Map above.

### 2. Set Up Realtime Database
1. Go to **Realtime Database** and click **Create Database**.
2. Select your closest Cloud region.
3. Import the security rules specified in `database.rules.json`. These rules ensure referees cannot modify opponent matches, change general settings, or reopen finalized scores.

### 3. Deploy Credentials
1. Under **Project Settings** > **General**, scroll to **Your Apps** and register a new **Web App**.
2. Copy the credentials object and paste them into `firebase-config.js` on your hosting server.
3. Once configured, the connection status bar will automatically change from `Local Demo Mode` to `ONLINE` with active real-time synchronization.

---

## 📊 LIVE INDIVIDUAL STANDINGS CALCULATION

Rather than permanently updating incremental leaderboard totals (which causes duplicate entries during corrections), the Standings board is compiled **on-the-fly** by reading all finalized match records. 

For each finalized match (e.g., Team A wins 15–11):
* Both Team A players receive **15 Tournament Points**, **1 Win**, **1 Game Played**, and **11 Points Against**.
* Both Team B players receive **11 Tournament Points**, **1 Loss**, **1 Game Played**, and **15 Points Against**.
* Standing Rankings are ordered by:
  1. **Points For** (highest first)
  2. **Wins** (highest first)
  3. **Point Difference** (Points For - Points Against, highest first)
  4. **Player Name** alphabetically.
