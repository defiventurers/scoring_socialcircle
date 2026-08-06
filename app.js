/**
 * THE SOCIAL CIRCLE - MIXED PICKLEBALL SOCIAL
 * Core Application Engine (Vanilla JavaScript)
 */

// Global State
let db = null;
let currentCourt = null; // Integer 1-4, or "admin"
let currentMatch = null; // Active match object
let matchesCache = {};   // Map of matchId -> matchObject
let serverLeaderboard = null;
let activeTournament = null;
let firebaseEnabled = false;
let activeTab = "score";
let isOnline = false;
let isSaving = false;
let workflowIntent = null;
let selectedTournamentId = null;
let tournamentCatalog = [];
let builderDraft = { sport: "pickleball", tournamentType: "mixed-doubles", scoringMode: "official", scoringFormat: "points" };

const TRADITIONAL_SCORING_FORMAT = "traditional-tennis";

const SPORT_RULE_PRESETS = {
  tennis: { name: "Tennis", events: ["mens-singles", "womens-singles", "mens-doubles", "womens-doubles", "mixed-doubles"], defaults: { scoringSystem: "traditional-tennis", matchFormat: "best-of-3-sets", sets: 3, gamesPerSet: 6, winBy: 2, tieBreak: true, tieBreakAt: "6-6", tieBreakPoints: 7, finalSetSuperTieBreak: false, noAd: false, rallyPoint: false, serviceRules: "standard", courtChanges: "standard" }, editable: ["sets", "gamesPerSet", "tieBreak", "tieBreakPoints", "finalSetSuperTieBreak", "noAd", "rallyPoint"] },
  padel: { name: "Padel", events: ["mens-doubles", "womens-doubles", "mixed-doubles"], defaults: { scoringSystem: "traditional-tennis", matchFormat: "best-of-3-sets", sets: 3, gamesPerSet: 6, winBy: 2, tieBreak: true, tieBreakAt: "6-6", tieBreakPoints: 7, goldenPoint: false, rallyPoint: false, serviceRules: "standard-padel" }, editable: ["sets", "gamesPerSet", "tieBreak", "tieBreakPoints", "goldenPoint", "rallyPoint"] },
  pickleball: { name: "Pickleball", events: ["mens-singles", "womens-singles", "mens-doubles", "womens-doubles", "mixed-doubles"], defaults: { scoringSystem: "official-pickleball", matchFormat: "best-of-3-games", bestOf: 3, targetScore: 11, winBy: 2, maximumCap: null, rallyScoring: false, serviceRules: "official-side-out" }, editable: ["bestOf", "targetScore", "winBy", "maximumCap", "rallyScoring", "serviceRules"] },
  badminton: { name: "Badminton", events: ["mens-singles", "womens-singles", "mens-doubles", "womens-doubles", "mixed-doubles"], defaults: { scoringSystem: "rally", matchFormat: "best-of-3-games", bestOf: 3, targetScore: 21, winBy: 2, maximumCap: 30, serviceRules: "official-bwf" }, editable: ["bestOf", "targetScore", "winBy", "maximumCap", "serviceRules"] },
  "table-tennis": { name: "Table Tennis", events: ["mens-singles", "womens-singles", "mens-doubles", "womens-doubles", "mixed-doubles"], defaults: { scoringSystem: "rally", matchFormat: "best-of-5-games", bestOf: 5, targetScore: 11, winBy: 2, serviceRotationFrequency: 2, serviceRules: "official-ittf" }, editable: ["bestOf", "targetScore", "winBy", "serviceRotationFrequency"] },
};
const EVENT_LABELS = { "mens-singles": "Men's Singles", "womens-singles": "Women's Singles", "mens-doubles": "Men's Doubles", "womens-doubles": "Women's Doubles", "mixed-doubles": "Mixed Doubles" };
function getActiveScoringRules(match = currentMatch) {
  const settings = activeTournament?.settings || {};
  const tournamentRules = settings.ruleConfiguration || {};
  const matchRules = match?.ruleConfiguration || {};
  const rules = { ...tournamentRules, ...matchRules };
  const nestedRules = { ...(tournamentRules.rules || {}), ...(matchRules.rules || {}) };
  const sport = match?.sport || settings.sport || activeTournament?.sport || rules.sport || nestedRules.sport || "pickleball";
  let scoringFormat = match?.scoringFormat || settings.scoringFormat || rules.scoringFormat || nestedRules.scoringFormat || "points";
  if ([rules.scoringSystem, nestedRules.scoringSystem, settings.scoringSystem].includes(TRADITIONAL_SCORING_FORMAT)) {
    scoringFormat = TRADITIONAL_SCORING_FORMAT;
  }
  const isTraditional = ["tennis", "padel"].includes(sport) && scoringFormat === TRADITIONAL_SCORING_FORMAT;
  const pointsToWin = Math.max(1, Number(match?.pointsToWin || activeTournament?.pointsToWin || nestedRules.targetScore || rules.targetScore || 15));
  const winBy = Math.max(1, Number(match?.winBy || activeTournament?.winBy || settings.winBy || nestedRules.winBy || rules.winBy || 1));
  return { sport, scoringFormat, isTraditional, pointsToWin, winBy, setsToWin: Math.ceil(Number(nestedRules.sets || rules.sets || settings.sets || 1) / 2), gamesPerSet: Number(nestedRules.gamesPerSet || rules.gamesPerSet || settings.gamesPerSet || 6), tieBreak: nestedRules.tieBreak ?? rules.tieBreak ?? settings.tieBreak ?? true, finalSetSuperTieBreak: nestedRules.finalSetSuperTieBreak ?? rules.finalSetSuperTieBreak ?? settings.finalSetSuperTieBreak ?? false };
}

function ensureTraditionalScore(match = currentMatch) {
  if (!match.tennisScore) match.tennisScore = { pointA: 0, pointB: 0, gamesA: 0, gamesB: 0, setsA: 0, setsB: 0, completedSets: [] };
  return match.tennisScore;
}

function tennisPointLabel(team, score = ensureTraditionalScore()) {
  const own = team === "A" ? score.pointA : score.pointB;
  const other = team === "A" ? score.pointB : score.pointA;
  if (own >= 3 && other >= 3) {
    if (own === other) return "Deuce";
    return own > other ? "Adv" : "40";
  }
  return ["0", "15", "30", "40"][Math.min(own, 3)] || "40";
}

function hasTraditionalGamePoint(score = ensureTraditionalScore()) {
  return Math.max(score.pointA, score.pointB) >= 4 && Math.abs(score.pointA - score.pointB) >= 2;
}

function isTraditionalMatchComplete(score = ensureTraditionalScore(), rules = getActiveScoringRules()) {
  return score.setsA >= rules.setsToWin || score.setsB >= rules.setsToWin;
}

function awardTraditionalPoint(team) {
  const rules = getActiveScoringRules();
  const score = ensureTraditionalScore();
  if (team === "A") score.pointA += 1; else score.pointB += 1;
  if (hasTraditionalGamePoint(score)) {
    const gameWinner = score.pointA > score.pointB ? "A" : "B";
    if (gameWinner === "A") score.gamesA += 1; else score.gamesB += 1;
    score.pointA = 0; score.pointB = 0;
    const gamesWon = Math.max(score.gamesA, score.gamesB);
    const gameMargin = Math.abs(score.gamesA - score.gamesB);
    const standardSetWon = gamesWon >= rules.gamesPerSet && gameMargin >= 2;
    const tieBreakSetWon = rules.tieBreak && gamesWon >= rules.gamesPerSet + 1;
    if (standardSetWon || tieBreakSetWon) {
      score.completedSets.push({ a: score.gamesA, b: score.gamesB });
      if (score.gamesA > score.gamesB) score.setsA += 1; else score.setsB += 1;
      score.gamesA = 0; score.gamesB = 0;
    }
  }
  currentMatch.teamAScore = score.setsA;
  currentMatch.teamBScore = score.setsB;
  return score;
}

function formatMatchScore(match = currentMatch) {
  const rules = getActiveScoringRules();
  if (!rules.isTraditional) return `${match?.teamAScore || 0} – ${match?.teamBScore || 0}`;
  const score = ensureTraditionalScore(match);
  const sets = score.completedSets.map((set) => `${set.a}-${set.b}`).join(", ");
  return `${sets ? `${sets} · ` : ""}${score.gamesA}-${score.gamesB}, ${tennisPointLabel("A", score)}-${tennisPointLabel("B", score)}`;
}

let loginStep = "tournament";

// Settings and Preferences (Sync with LocalStorage)
let voiceEnabled = localStorage.getItem("voice_enabled") !== "false"; // default true
let leaderboardDetailed = localStorage.getItem("leaderboard_detailed") === "true"; // default false

// Timer state
let timerInterval = null;
let timerRemainingSeconds = 8 * 60;
let timerRunning = false;
let timerMatchId = null;

// Local Demo Database Store (for fallback)
const LOCAL_STORAGE_KEY = "pickleball_social_matches";
const LOCAL_USERS_KEY = "pickleball_social_court_users";

// Initialize Application
window.addEventListener("DOMContentLoaded", () => {
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) document.body.classList.add("development");
  initFirebase();
  loadSavedPreferences();
  initLucide();
  setupEventListeners();
  checkAutologin();
  
  // Start checking connection status
  if (!firebaseEnabled) {
    setOnlineStatus(true); // Always online in local demo mode
  }
});

function showOnlyScreen(screenId) {
  ["welcome-screen", "home-screen", "login-screen", "dashboard-screen"].forEach((id) => {
    document.getElementById(id)?.classList.toggle("hidden", id !== screenId);
  });
  window.scrollTo({ top: 0, behavior: "auto" });
}

function showLoginStep(step) {
  loginStep = step;
  ["tournament", "court", "pin"].forEach((name) => {
    document.getElementById(`login-step-${name}`)?.classList.toggle("hidden", name !== step);
  });
  const subtitles = { tournament: "Choose a tournament", court: "Choose your court", pin: "Enter your access PIN" };
  const subtitle = document.getElementById("login-workflow-subtitle");
  if (subtitle) subtitle.textContent = subtitles[step] || "";
  window.scrollTo({ top: 0, behavior: "auto" });
}

function startRefereeFlow() {
  workflowIntent = "referee";
  currentCourt = null;
  document.getElementById("login-workflow-title").textContent = "Score Tournament";
  showOnlyScreen("login-screen");
  showLoginStep("tournament");
  loadTournamentCatalog();
}

function startCreateTournamentFlow() {
  workflowIntent = "create";
  currentCourt = "admin";
  showOnlyScreen("dashboard-screen");
  switchTab("builder");
  initializeTournamentBuilder();
}

function startAdminFlow() {
  workflowIntent = "admin";
  startAdminAuthentication("Admin Access");
}

function startAdminAuthentication(title) {
  currentCourt = "admin";
  document.getElementById("login-workflow-title").textContent = title;
  document.getElementById("login-auth-title").textContent = "Enter administrator PIN";
  document.getElementById("selected-court-title").textContent = "Administrator";
  const submit = document.getElementById("btn-submit-login");
  if (submit) submit.innerHTML = '<i data-lucide="lock"></i> Continue';
  showOnlyScreen("login-screen");
  showLoginStep("pin");
  document.getElementById("court-pin-input").value = "";
  document.getElementById("court-pin-input").focus();
  initLucide();
}

function loadTournamentCatalog() {
  const container = document.getElementById("tournament-selection-list");
  if (container) container.innerHTML = '<div class="empty-state">Tournament selection requires the shared server connection.</div>';
}

function chooseTournament(tournamentId) {
  const tournament = tournamentCatalog.find((item) => item.id === tournamentId);
  if (!tournament) return;
  selectedTournamentId = tournament.id;
  activeTournament = tournament;
  renderCourtSelection(Number(tournament.numberOfCourts || 1));
  showLoginStep("court");
}

function renderCourtSelection(count) {
  const grid = document.getElementById("court-selection-grid");
  if (!grid) return;
  grid.innerHTML = "";
  for (let court = 1; court <= Math.max(1, Math.min(4, count)); court += 1) {
    const button = document.createElement("button");
    button.className = "court-card";
    button.innerHTML = `<span class="number">${court}</span><span class="label">Court</span>`;
    button.addEventListener("click", () => selectCourt(court));
    grid.appendChild(button);
  }
}

function goBackInWorkflow() {
  if (!document.getElementById("login-screen")?.classList.contains("hidden")) {
    if (loginStep === "pin" && workflowIntent === "referee") return showLoginStep("court");
    if (loginStep === "court") return showLoginStep("tournament");
    showOnlyScreen("home-screen");
    return;
  }
  if (activeTab === "score" && currentCourt !== "admin") return switchTab("matches");
  if (activeTab === "builder" && workflowIntent === "create") return logoutSession();
  if (["builder", "players"].includes(activeTab)) return switchTab("admin");
  if (activeTab === "admin") return logoutSession();
  showOnlyScreen("home-screen");
}

function openAdminMatchManager() {
  document.getElementById("admin-match-manager")?.classList.remove("hidden");
  document.getElementById("admin-match-manager")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeAdminMatchManager() {
  document.getElementById("admin-match-manager")?.classList.add("hidden");
}


// Initialize Icons
function initLucide() {
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
}

function escapeMarkup(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 1. FIREBASE INITIALIZATION & FALLBACK
function initFirebase() {
  const badge = document.getElementById("firebase-mode-badge");
  
  // Check if firebaseConfig is valid and not placeholders
  const isPlaceholder = !window.firebaseConfig || 
                        window.firebaseConfig.apiKey === "YOUR_API_KEY_HERE" ||
                        window.firebaseConfig.apiKey.includes("YOUR_");
                        
  if (isPlaceholder || typeof firebase === "undefined") {
    console.warn("Firebase config is empty or placeholder. Booting in LOCAL DEMO MODE.");
    firebaseEnabled = false;
    if (badge) {
      badge.textContent = "Local Demo Mode (LocalStorage)";
      badge.style.color = "var(--gold-accent)";
    }
    setupLocalDatabase();
    bindLocalListeners();
  } else {
    try {
      firebase.initializeApp(window.firebaseConfig);
      db = firebase.database();
      firebaseEnabled = true;
      if (badge) {
        badge.textContent = "Firebase RTDB Connected";
        badge.style.color = "var(--success)";
      }
      setupFirebaseConnectionListener();
      bindFirebaseListeners();
    } catch (err) {
      console.error("Firebase init failed, falling back to Local Demo Mode:", err);
      firebaseEnabled = false;
      if (badge) {
        badge.textContent = "Local Demo (Fallback)";
      }
      setupLocalDatabase();
      bindLocalListeners();
    }
  }
}

// Set up connection listener for real Firebase
function setupFirebaseConnectionListener() {
  const connectedRef = firebase.database().ref(".info/connected");
  connectedRef.on("value", (snap) => {
    setOnlineStatus(snap.val() === true);
  });
}

// Set Online/Offline Visuals
function setOnlineStatus(online) {
  isOnline = online;
  const dot = document.getElementById("connection-dot");
  const text = document.getElementById("connection-text");
  const offlineOverlay = document.getElementById("offline-overlay");
  
  if (online) {
    dot.className = "status-dot online";
    text.textContent = "ONLINE";
    if (offlineOverlay) offlineOverlay.classList.add("hidden");
  } else {
    dot.className = "status-dot offline";
    text.textContent = "OFFLINE";
    if (offlineOverlay) offlineOverlay.classList.remove("hidden");
  }
}

// Update saving indicators
function setSavingState(saving, failed = false) {
  isSaving = saving;
  const dot = document.getElementById("connection-dot");
  const text = document.getElementById("connection-text");
  
  if (failed) {
    dot.className = "status-dot offline";
    text.textContent = "SAVE FAILED";
    return;
  }
  
  if (saving) {
    dot.className = "status-dot saving";
    text.textContent = "SAVING SCORES...";
  } else if (isOnline) {
    dot.className = "status-dot online";
    text.textContent = "ONLINE & SAVED";
  }
}

// 2. LOCAL DATABASE AND MOCK AUTH
function setupLocalDatabase() {
  let stored = localStorage.getItem(LOCAL_STORAGE_KEY);
  let shouldSeed = false;
  let parsed = null;
  
  if (stored) {
    try {
      parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object" || Object.keys(parsed).length === 0) {
        shouldSeed = true;
      }
    } catch (e) {
      shouldSeed = true;
    }
  } else {
    shouldSeed = true;
  }

  const storedTournament = localStorage.getItem("aceo_active_tournament");
  if (storedTournament) {
    try { activeTournament = JSON.parse(storedTournament); } catch (e) { activeTournament = null; }
  }

  if (shouldSeed) {
    // Seed matches from fixtures
    const initialMatches = {};
    for (let courtNum = 1; courtNum <= 4; courtNum++) {
      const courtFixtures = window.FIXTURES[courtNum] || [];
      courtFixtures.forEach((fix) => {
        const matchId = `court${courtNum}_round${fix.round}`;
        initialMatches[matchId] = {
          id: matchId,
          court: courtNum,
          round: fix.round,
          time: fix.time,
          teamA: fix.teamA,
          teamB: fix.teamB,
          teamAScore: 0,
          teamBScore: 0,
          status: "scheduled",
          scoreHistory: [],
          startedAt: null,
          finalizedAt: null,
          finalizedBy: null,
          finishReason: null
        };
      });
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(initialMatches));
  } else if (parsed && !activeTournament && Object.keys(parsed).length === 80) {
    // Self-healing: Update names or times if fixtures.js was corrected for the bundled demo event.
    let updated = false;
    for (let courtNum = 1; courtNum <= 4; courtNum++) {
      const courtFixtures = window.FIXTURES[courtNum] || [];
      courtFixtures.forEach((fix) => {
        const matchId = `court${courtNum}_round${fix.round}`;
        if (parsed[matchId]) {
          const m = parsed[matchId];
          const matchA = JSON.stringify(m.teamA) === JSON.stringify(fix.teamA);
          const matchB = JSON.stringify(m.teamB) === JSON.stringify(fix.teamB);
          if (!matchA || !matchB || m.time !== fix.time) {
            m.teamA = fix.teamA;
            m.teamB = fix.teamB;
            m.time = fix.time;
            updated = true;
          }
        }
      });
    }
    if (updated) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
    }
  }
  
  // Setup Mock Court Users mapping
  let users = localStorage.getItem(LOCAL_USERS_KEY);
  if (!users) {
    const mockUsers = {
      "mock_court_1_uid": 1,
      "mock_court_2_uid": 2,
      "mock_court_3_uid": 3,
      "mock_court_4_uid": 4,
      "mock_admin_uid": "admin"
    };
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(mockUsers));
  }
}

// Sync Local DB to state
function bindLocalListeners() {
  // Read state instantly, and trigger recalculations
  onMatchesDataChanged(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)));
}

// Read and update Realtime Database
function bindFirebaseListeners() {
  const matchesRef = db.ref("matches");
  
  // Seed Firebase if it is empty!
  matchesRef.once("value", (snap) => {
    if (!snap.exists()) {
      console.log("Firebase database is empty. Seeding matches from fixture list...");
      const seedData = {};
      
      // Initialize event settings
      db.ref("eventSettings").set({
        eventName: "The Social Circle Mixed Pickleball Social",
        targetScore: 15,
        roundDurationMinutes: 8,
        numberOfCourts: 4,
        numberOfRounds: 20,
        scoringType: "rally",
        serviceRotationPoints: 2,
        allowTimeLimitResults: true
      });
      
      // We also set the court users mapping
      // In a production app, the administrator sets these UIDs once referees sign up.
      db.ref("courtUsers").set({
        "court1_uid_placeholder": 1,
        "court2_uid_placeholder": 2,
        "court3_uid_placeholder": 3,
        "court4_uid_placeholder": 4
      });

      for (let courtNum = 1; courtNum <= 4; courtNum++) {
        const courtFixtures = window.FIXTURES[courtNum] || [];
        courtFixtures.forEach((fix) => {
          const matchId = `court${courtNum}_round${fix.round}`;
          seedData[matchId] = {
            id: matchId,
            court: courtNum,
            round: fix.round,
            time: fix.time,
            teamA: fix.teamA,
            teamB: fix.teamB,
            teamAScore: 0,
            teamBScore: 0,
            status: "scheduled",
            scoreHistory: [],
            startedAt: null,
            finalizedAt: null,
            finalizedBy: null,
            finishReason: null
          };
        });
      }
      matchesRef.set(seedData);
    } else {
      // Firebase data exists: self-heal or update players/times if modified in fixtures.js
      const currentMatches = snap.val() || {};
      let hasUpdates = false;
      const updatedMatches = { ...currentMatches };
      
      for (let courtNum = 1; courtNum <= 4; courtNum++) {
        const courtFixtures = window.FIXTURES[courtNum] || [];
        courtFixtures.forEach((fix) => {
          const matchId = `court${courtNum}_round${fix.round}`;
          if (!updatedMatches[matchId]) {
            updatedMatches[matchId] = {
              id: matchId,
              court: courtNum,
              round: fix.round,
              time: fix.time,
              teamA: fix.teamA,
              teamB: fix.teamB,
              teamAScore: 0,
              teamBScore: 0,
              status: "scheduled",
              scoreHistory: [],
              startedAt: null,
              finalizedAt: null,
              finalizedBy: null,
              finishReason: null
            };
            hasUpdates = true;
          } else {
            const m = updatedMatches[matchId];
            const matchA = JSON.stringify(m.teamA) === JSON.stringify(fix.teamA);
            const matchB = JSON.stringify(m.teamB) === JSON.stringify(fix.teamB);
            if (!matchA || !matchB || m.time !== fix.time) {
              m.teamA = fix.teamA;
              m.teamB = fix.teamB;
              m.time = fix.time;
              hasUpdates = true;
            }
          }
        });
      }
      if (hasUpdates) {
        console.log("Syncing updated fixtures to Firebase database...");
        matchesRef.update(updatedMatches);
      }
    }
  });

  // Attach live synchronizing listener
  matchesRef.on("value", (snap) => {
    if (snap.exists()) {
      onMatchesDataChanged(snap.val());
    }
  });
}

// Core matches synchronization callback
function onMatchesDataChanged(matches) {
  matchesCache = matches || {};
  
  // Redraw dashboards depending on logged state
  if (currentCourt !== null) {
    updateActiveMatchState();
    renderMatchesList();
    renderLeaderboard();
    if (currentCourt === "admin") {
      renderAdminPortal();
    }
  }
}

// 3. SECURE AUTHENTICATION FLOW
function selectCourt(num) {
  currentCourt = num;
  loginStep = "pin";
  document.getElementById("selected-court-title").textContent = `Court ${num}`;
  document.getElementById("login-auth-title").textContent = "Enter referee PIN";
  document.getElementById("login-step-court").classList.add("hidden");
  document.getElementById("login-step-pin").classList.remove("hidden");
  const submit = document.getElementById("btn-submit-login");
  if (submit) submit.innerHTML = '<i data-lucide="lock"></i> Authenticate Referee';
  document.getElementById("court-pin-input").value = "";
  document.getElementById("court-pin-input").focus();
  document.getElementById("login-error").classList.add("hidden");
  initLucide();
}

function goBackToCourts() {
  showLoginStep("court");
}

// Submit 4-digit PIN mapping to Firebase accounts
function submitPinLogin() {
  const pin = document.getElementById("court-pin-input").value;
  const errorEl = document.getElementById("login-error");
  
  if (!pin || pin.length < 4) {
    errorEl.textContent = "Please enter a 4-digit PIN.";
    errorEl.classList.remove("hidden");
    return;
  }
  
  if (!firebaseEnabled) {
    // Local Demo authentication
    const isCourtPin = pin === `${currentCourt}${currentCourt}${currentCourt}${currentCourt}`;
    const isAdminPin = currentCourt === "admin" && (pin === "9999" || pin === "2026");
    const isMasterPin = pin === "2026";
    
    if (isCourtPin || isAdminPin || isMasterPin) {
      loginSuccess(currentCourt, `demo_user_court_${currentCourt}`);
    } else {
      const expected = currentCourt === "admin" ? "9999" : `${currentCourt}${currentCourt}${currentCourt}${currentCourt}`;
      errorEl.textContent = `Invalid PIN. Demo Tip: Enter "${expected}" or "2026".`;
      errorEl.classList.remove("hidden");
    }
    return;
  }
  
  // Real Firebase Auth Integration
  const email = currentCourt === "admin" ? "admin@socialcircle.app" : `court${currentCourt}@socialcircle.app`;
  
  setSavingState(true);
  firebase.auth().signInWithEmailAndPassword(email, pin)
    .then((userCredential) => {
      const user = userCredential.user;
      
      // Admin bypasses courtUsers mapping check or maps directly
      if (currentCourt === "admin") {
        setSavingState(false);
        loginSuccess("admin", user.uid);
        return;
      }
      
      // Verify uid is authorized for this court
      db.ref(`courtUsers/${user.uid}`).once("value")
        .then((snapshot) => {
          setSavingState(false);
          const assignedCourt = snapshot.val();
          
          if (assignedCourt === currentCourt) {
            loginSuccess(currentCourt, user.uid);
          } else {
            // Authorized referee account, but mismatch court number
            if (assignedCourt === null) {
              // Assign UID to court on the fly for ease of onboarding!
              db.ref(`courtUsers/${user.uid}`).set(currentCourt);
              loginSuccess(currentCourt, user.uid);
            } else {
              firebase.auth().signOut();
              errorEl.textContent = `This account is authorized for Court ${assignedCourt}, not Court ${currentCourt}.`;
              errorEl.classList.remove("hidden");
            }
          }
        })
        .catch((err) => {
          // If courtUsers mapping does not exist yet, allow on-the-fly bootstrapping
          db.ref(`courtUsers/${user.uid}`).set(currentCourt);
          loginSuccess(currentCourt, user.uid);
        });
    })
    .catch((error) => {
      setSavingState(false);
      console.error("Firebase Login Error:", error);
      errorEl.textContent = "Invalid Court PIN or Network Error.";
      errorEl.classList.remove("hidden");
    });
}

// Quick Admin Direct trigger
function tryAdminLoginDirect() {
  startAdminFlow();
}

// Logged in successfully
function loginSuccess(court, userId) {
  localStorage.setItem("saved_court", court);
  localStorage.setItem("saved_uid", userId);
  currentCourt = court;

  const titleEl = document.getElementById("referee-court-title");
  titleEl.textContent = court === "admin" ? "ADMIN DASHBOARD" : `COURT ${court} REFEREE`;

  showOnlyScreen("dashboard-screen");
  if (court === "admin" && workflowIntent === "create") {
    switchTab("builder");
    initializeTournamentBuilder();
  } else {
    switchTab(court === "admin" ? "admin" : "matches");
  }
  onMatchesDataChanged(matchesCache);
}

function continueFromWelcome() {
  workflowIntent = null;
  currentCourt = null;
  showOnlyScreen("home-screen");
}

function checkAutologin() {
  showOnlyScreen("welcome-screen");
}

function logoutSession() {
  if (firebaseEnabled && typeof firebase !== "undefined" && firebase.auth) {
    firebase.auth().signOut().catch(e => console.error(e));
  }
  localStorage.removeItem("saved_court");
  localStorage.removeItem("saved_uid");
  currentCourt = null;
  currentMatch = null;
  workflowIntent = null;
  selectedTournamentId = null;
  pauseTimer();
  showOnlyScreen("home-screen");
}

// 4. TAB NAVIGATION & VIEWS
function switchTab(tabId) {
  if (currentCourt !== "admin" && !["score", "matches"].includes(tabId)) return;
  activeTab = tabId;

  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  document.getElementById(`${tabId}-panel`)?.classList.add("active");

  const title = document.getElementById("referee-court-title");
  const subtitle = document.getElementById("referee-round-title");
  if (currentCourt === "admin") {
    if (title) title.textContent = tabId === "builder" ? "TOURNAMENT BUILDER" : tabId === "players" ? "PLAYER DIRECTORY" : tabId === "player-schedules" ? "PLAYER SCHEDULES" : "ADMIN DASHBOARD";
    if (subtitle) subtitle.textContent = tabId === "admin" ? "TOURNAMENT OPERATIONS" : "ADMINISTRATION";
  } else if (tabId === "matches") {
    if (title) title.textContent = `COURT ${currentCourt} REFEREE`;
    if (subtitle) subtitle.textContent = "MATCH QUEUE";
    const queueLabel = document.getElementById("queue-court-label");
    if (queueLabel) queueLabel.textContent = `Court ${currentCourt}`;
  }

  if (tabId === "matches") renderMatchesList();
  if (tabId === "leaderboard") renderLeaderboard();
  if (tabId === "admin" && currentCourt === "admin") renderAdminPortal();
  window.scrollTo({ top: 0, behavior: "auto" });
}

// 5. REFEREE ACTIVE MATCH & PROGRESSION
function updateActiveMatchState() {
  if (currentCourt === "admin") {
    // Admins don't have a single active match, they view all. Let's load Court 1 Match 1 as default scoring panel
    // or keep activeMatch as null
    if (!currentMatch) {
      currentMatch = getFirstUnfinishedMatch(1);
    }
  } else {
    // Find first unfinished match for this court
    const unfinished = getFirstUnfinishedMatch(currentCourt);
    currentMatch = unfinished || getLastCompletedMatch(currentCourt) || getFirstMatch(currentCourt);
  }
  
  renderActiveScoreboard();
}

function getFirstUnfinishedMatch(courtNum) {
  const matches = Object.values(matchesCache).filter(m => m.court === courtNum);
  matches.sort((a, b) => a.round - b.round);
  return matches.find(m => m.status !== "finalized");
}

function getLastCompletedMatch(courtNum) {
  const matches = Object.values(matchesCache).filter(m => m.court === courtNum && m.status === "finalized");
  matches.sort((a, b) => b.round - a.round); // latest completed
  return matches[0];
}

function getFirstMatch(courtNum) {
  const matches = Object.values(matchesCache).filter(m => m.court === courtNum);
  matches.sort((a, b) => a.round - b.round);
  return matches[0];
}

// Render Core Scoreboard GUI
function renderActiveScoreboard() {
  if (!currentMatch) {
    document.getElementById("referee-round-title").textContent = "NO ACTIVE EVENT";
    document.getElementById("score-round-num").textContent = "-";
    document.getElementById("score-time-val").textContent = "-";
    document.getElementById("score-status-val").textContent = "NO MATCH";
    document.getElementById("player-a1").textContent = "Waiting for";
    document.getElementById("player-a2").textContent = "next event";
    document.getElementById("player-b1").textContent = "Waiting for";
    document.getElementById("player-b2").textContent = "next event";
    document.getElementById("score-val-a").textContent = "0";
    document.getElementById("score-val-b").textContent = "0";
    document.getElementById("btn-add-a").setAttribute("disabled", "true");
    document.getElementById("btn-add-b").setAttribute("disabled", "true");
    document.getElementById("btn-score-undo").setAttribute("disabled", "true");
    document.getElementById("btn-match-finalize-trigger").setAttribute("disabled", "true");
    document.getElementById("next-match-details").textContent = "No published event. An administrator can create the next event.";
    return;
  }
  
  // Header Meta
  const configuredRounds = Number(activeTournament?.settings?.numberOfRounds || Math.max(1, ...Object.values(matchesCache).map((match) => Number(match.round || 0))));
  const scoringRules = getActiveScoringRules();
  const targetScore = scoringRules.pointsToWin;
  const manualOverrides = activeTournament?.settings?.allowManualScoreOverrides !== false;
  document.getElementById("referee-round-title").textContent = `ROUND ${currentMatch.round} OF ${configuredRounds}`;
  document.getElementById("score-round-num").textContent = currentMatch.round;
  document.getElementById("score-time-val").textContent = currentMatch.time;
  
  const statusEl = document.getElementById("score-status-val");
  statusEl.textContent = currentMatch.status.toUpperCase();
  statusEl.className = "meta-val " + (currentMatch.status === "finalized" ? "status-finalized" : currentMatch.status === "active" ? "status-active" : "status-scheduled");
  
  // Players
  document.getElementById("player-a1").textContent = currentMatch.teamA[0] || "Player A1";
  document.getElementById("player-a2").textContent = currentMatch.teamA[1] || "Player A2";
  document.getElementById("player-b1").textContent = currentMatch.teamB[0] || "Player B1";
  document.getElementById("player-b2").textContent = currentMatch.teamB[1] || "Player B2";
  
  // Scores
  if (scoringRules.isTraditional) {
    const tennisScore = ensureTraditionalScore(currentMatch);
    document.getElementById("score-val-a").textContent = tennisPointLabel("A", tennisScore);
    document.getElementById("score-val-b").textContent = tennisPointLabel("B", tennisScore);
    document.getElementById("score-round-num").textContent = `${tennisScore.setsA}-${tennisScore.setsB} sets · ${tennisScore.gamesA}-${tennisScore.gamesB} games`;
  } else {
    document.getElementById("score-val-a").textContent = currentMatch.teamAScore;
    document.getElementById("score-val-b").textContent = currentMatch.teamBScore;
  }
  
  // Serving status
  const tennisScore = scoringRules.isTraditional ? ensureTraditionalScore(currentMatch) : null;
  const totalPoints = scoringRules.isTraditional ? tennisScore.pointA + tennisScore.pointB + tennisScore.gamesA + tennisScore.gamesB : currentMatch.teamAScore + currentMatch.teamBScore;
  const serviceBlock = Math.floor(totalPoints / 2);
  const servingTeam = serviceBlock % 2 === 0 ? "A" : "B";
  
  const badgeA = document.getElementById("serve-badge-a");
  const badgeB = document.getElementById("serve-badge-b");
  const cardA = document.getElementById("card-team-a");
  const cardB = document.getElementById("card-team-b");
  
  cardA.classList.remove("serving");
  cardB.classList.remove("serving");
  badgeA.classList.add("hidden");
  badgeB.classList.add("hidden");
  
  if (currentMatch.status !== "finalized") {
    if (servingTeam === "A") {
      cardA.classList.add("serving");
      badgeA.classList.remove("hidden");
    } else {
      cardB.classList.add("serving");
      badgeB.classList.remove("hidden");
    }
  }
  
  // Disable score additions if finalized
  const btnA = document.getElementById("btn-add-a");
  const btnB = document.getElementById("btn-add-b");
  const finalizeTrigger = document.getElementById("btn-match-finalize-trigger");
  
  if (currentMatch.status === "finalized") {
    btnA.setAttribute("disabled", "true");
    btnB.setAttribute("disabled", "true");
    btnA.style.opacity = "0.5";
    btnB.style.opacity = "0.5";
    finalizeTrigger.innerHTML = `<i data-lucide="check"></i> Match Finalized (Locked)`;
    finalizeTrigger.className = "btn btn-secondary";
    finalizeTrigger.setAttribute("disabled", "true");
  } else {
    btnA.removeAttribute("disabled");
    btnB.removeAttribute("disabled");
    btnA.style.opacity = "1";
    btnB.style.opacity = "1";
    
    // Highlight if the selected scoring engine says the match is complete
    if (scoringRules.isTraditional ? isTraditionalMatchComplete(ensureTraditionalScore(currentMatch), scoringRules) : (currentMatch.teamAScore >= targetScore || currentMatch.teamBScore >= targetScore)) {
      finalizeTrigger.className = "btn btn-gold";
      finalizeTrigger.innerHTML = `<i data-lucide="trophy"></i> Ready to Finalize Match!`;
    } else {
      finalizeTrigger.className = "btn btn-primary";
      finalizeTrigger.innerHTML = `<i data-lucide="check-circle-2"></i> Finalize Match Results`;
    }
    finalizeTrigger.removeAttribute("disabled");
  }
  
  // Undo and manual-entry availability
  const undoBtn = document.getElementById("btn-score-undo");
  const manualButton = document.getElementById("btn-manual-score");
  if (manualButton) {
    manualButton.classList.toggle("hidden", !manualOverrides);
    manualButton.disabled = !manualOverrides || currentMatch.status === "finalized";
  }
  if (currentMatch.status === "finalized" || !currentMatch.scoreHistory || currentMatch.scoreHistory.length === 0) {
    undoBtn.setAttribute("disabled", "true");
  } else {
    undoBtn.removeAttribute("disabled");
  }
  
  // Next match info
  const nextMatch = Object.values(matchesCache).find(m => m.court === currentMatch.court && m.round === currentMatch.round + 1);
  const nextEl = document.getElementById("next-match-details");
  if (nextMatch) {
    nextEl.textContent = `Round ${nextMatch.round} at ${nextMatch.time} — ${nextMatch.teamA.join(" / ")} vs ${nextMatch.teamB.join(" / ")}`;
  } else {
    nextEl.textContent = "This is the final scheduled match on this court.";
  }

  syncTimerForCurrentMatch();
  initLucide();
}

// 6. SCORING MECHANICS & ACTIONS (METHOD A)
function incrementScore(team) {
  if (!currentMatch || currentMatch.status === "finalized") return;
  
  // Offline Guard on critical submission
  if (!isOnline && !firebaseEnabled) {
    alert("Device is offline. Safe storage pending reconnect.");
  }
  
  const scoringRules = getActiveScoringRules();
  if (!scoringRules.isTraditional && Math.max(currentMatch.teamAScore, currentMatch.teamBScore) >= scoringRules.pointsToWin && Math.abs(currentMatch.teamAScore - currentMatch.teamBScore) >= scoringRules.winBy) {
    if (confirm(`Target score of ${scoringRules.pointsToWin} already achieved. Finalize this result or enter a manual score instead?`)) {
      triggerFinalizeModal();
    }
    return;
  }
  if (scoringRules.isTraditional && isTraditionalMatchComplete(ensureTraditionalScore(currentMatch), scoringRules)) {
    triggerFinalizeModal();
    return;
  }
  
  // Support haptic feedback vibrate 30ms
  if (navigator.vibrate) {
    navigator.vibrate(30);
  }
  
  // Capture historical state for Undo
  const currentHistory = currentMatch.scoreHistory ? [...currentMatch.scoreHistory] : [];
  currentHistory.push({
    teamAScore: currentMatch.teamAScore,
    teamBScore: currentMatch.teamBScore,
    tennisScore: currentMatch.tennisScore ? JSON.parse(JSON.stringify(currentMatch.tennisScore)) : null
  });
  
  let newScoreA = currentMatch.teamAScore;
  let newScoreB = currentMatch.teamBScore;
  
  if (scoringRules.isTraditional) {
    awardTraditionalPoint(team);
    newScoreA = currentMatch.teamAScore;
    newScoreB = currentMatch.teamBScore;
  } else if (team === "A") {
    newScoreA += 1;
  } else {
    newScoreB += 1;
  }
  
  // Update state locally first for instant visual feedback
  const oldA = currentMatch.teamAScore;
  const oldB = currentMatch.teamBScore;
  
  if (!scoringRules.isTraditional) {
    currentMatch.teamAScore = newScoreA;
    currentMatch.teamBScore = newScoreB;
  }
  currentMatch.scoreHistory = currentHistory;
  if (currentMatch.status === "scheduled") {
    currentMatch.status = "active";
    currentMatch.startedAt = Date.now();
  }
  
  renderActiveScoreboard();
  
  // Speak vocal call
  speakCurrentScore(scoringRules.isTraditional ? tennisPointLabel("A") : newScoreA, scoringRules.isTraditional ? tennisPointLabel("B") : newScoreB, team);
  
  // Commit to DB (Firebase or LocalStorage)
  saveMatchToDatabase(currentMatch);
}

// Save match object to relevant storage
function saveMatchToDatabase(matchObj, callback) {
  setSavingState(true);
  
  if (!firebaseEnabled) {
    // LocalStorage write
    setTimeout(() => {
      try {
        const matches = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)) || {};
        matches[matchObj.id] = matchObj;
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(matches));
        setSavingState(false);
        if (callback) callback(true);
        // Dispatch data change
        onMatchesDataChanged(matches);
      } catch (e) {
        setSavingState(false, true);
        if (callback) callback(false);
      }
    }, 150); // Simulate network latency
  } else {
    // Real Firebase write
    db.ref(`matches/${matchObj.id}`).set(matchObj)
      .then(() => {
        setSavingState(false);
        if (callback) callback(true);
      })
      .catch((err) => {
        console.error("Firebase write error:", err);
        setSavingState(false, true);
        if (callback) callback(false);
      });
  }
}

// Undo Action
function performUndo() {
  if (!currentMatch || currentMatch.status === "finalized") return;
  if (!currentMatch.scoreHistory || currentMatch.scoreHistory.length === 0) return;
  
  const history = [...currentMatch.scoreHistory];
  const prevState = history.pop(); // retrieve last state
  
  currentMatch.teamAScore = prevState.teamAScore;
  currentMatch.teamBScore = prevState.teamBScore;
  currentMatch.tennisScore = prevState.tennisScore ? JSON.parse(JSON.stringify(prevState.tennisScore)) : currentMatch.tennisScore;
  currentMatch.scoreHistory = history;
  
  // If reverted back to 0-0, reset active status if scheduled previously
  if (prevState.teamAScore === 0 && prevState.teamBScore === 0) {
    currentMatch.status = "scheduled";
    currentMatch.startedAt = null;
  }
  
  renderActiveScoreboard();
  saveMatchToDatabase(currentMatch);
}

// 7. QUICK MANUAL ENTRY (METHOD B)
function openQuickScoreSheet() {
  if (!currentMatch || currentMatch.status === "finalized") return;
  if (getActiveScoringRules().isTraditional) {
    alert("Traditional tennis/padel matches use point-by-point game and set scoring. Use the scoreboard controls to enter scores.");
    return;
  }
  
  document.getElementById("quick-score-a").value = currentMatch.teamAScore;
  document.getElementById("quick-score-b").value = currentMatch.teamBScore;
  document.getElementById("quick-score-time-limit").checked = timerRemainingSeconds <= 0;
  document.getElementById("quick-score-validation-error").classList.add("hidden");
  
  document.getElementById("quick-score-overlay").classList.add("active");
  toggleQuickScoreRuleTip();
}

function closeQuickScoreSheet() {
  document.getElementById("quick-score-overlay").classList.remove("active");
}

function toggleQuickScoreRuleTip() {
  const isTimeLimit = document.getElementById("quick-score-time-limit").checked;
  const errorEl = document.getElementById("quick-score-validation-error");
  
  errorEl.className = "meta-label";
  errorEl.style.color = "var(--gold-accent)";
  errorEl.style.marginTop = "8px";
  errorEl.classList.remove("hidden");
  
  if (isTimeLimit) {
    errorEl.textContent = "Rule: Scores can be below 15, but tied scores are prohibited.";
  } else {
    errorEl.textContent = "Rule: One score must be exactly 15; opponent score from 0-14.";
  }
}

function saveQuickScores() {
  const scoreA = parseInt(document.getElementById("quick-score-a").value);
  const scoreB = parseInt(document.getElementById("quick-score-b").value);
  const isTimeLimit = document.getElementById("quick-score-time-limit").checked;
  const errorEl = document.getElementById("quick-score-validation-error");
  
  // Validations
  if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
    errorEl.textContent = "Scores must be positive numeric values.";
    errorEl.style.color = "var(--danger)";
    errorEl.classList.remove("hidden");
    return;
  }
  
  if (scoreA === scoreB) {
    errorEl.textContent = "Tied scores are not allowed. Please enter a decider point result.";
    errorEl.style.color = "var(--danger)";
    errorEl.classList.remove("hidden");
    return;
  }
  
  if (!isTimeLimit) {
    // Normal match rules: First to 15 wins
    if (scoreA !== 15 && scoreB !== 15) {
      errorEl.textContent = "Standard rules: one team must score exactly 15 to win.";
      errorEl.style.color = "var(--danger)";
      errorEl.classList.remove("hidden");
      return;
    }
    if (scoreA > 15 || scoreB > 15) {
      errorEl.textContent = "Standard rally scoring stops at exactly 15 points (Win by 1).";
      errorEl.style.color = "var(--danger)";
      errorEl.classList.remove("hidden");
      return;
    }
  } else {
    // Time limit rules
    if (scoreA > 15 || scoreB > 15) {
      errorEl.textContent = "Scores cannot exceed 15 points.";
      errorEl.style.color = "var(--danger)";
      errorEl.classList.remove("hidden");
      return;
    }
  }
  
  // Success! Save manually corrected score
  const currentHistory = currentMatch.scoreHistory ? [...currentMatch.scoreHistory] : [];
  currentHistory.push({
    teamAScore: currentMatch.teamAScore,
    teamBScore: currentMatch.teamBScore
  });
  
  currentMatch.teamAScore = scoreA;
  currentMatch.teamBScore = scoreB;
  currentMatch.scoreHistory = currentHistory;
  currentMatch.status = "active";
  if (!currentMatch.startedAt) currentMatch.startedAt = Date.now();
  currentMatch.finishReason = isTimeLimit ? "time-limit" : "target-score";
  
  renderActiveScoreboard();
  saveMatchToDatabase(currentMatch);
  closeQuickScoreSheet();
}

// 8. FINALIZATION LOGIC
function triggerFinalizeModal() {
  if (!currentMatch || currentMatch.status === "finalized") return;
  
  if (!isOnline && firebaseEnabled) {
    alert("Match finalization is disabled while offline. Please restore connection first.");
    return;
  }
  
  const scoringRules = getActiveScoringRules();
  const scoreA = currentMatch.teamAScore;
  const scoreB = currentMatch.teamBScore;
  const tennisScore = scoringRules.isTraditional ? ensureTraditionalScore(currentMatch) : null;
  const hasTraditionalProgress = tennisScore && (tennisScore.pointA || tennisScore.pointB || tennisScore.gamesA || tennisScore.gamesB || tennisScore.setsA || tennisScore.setsB);
  
  if (scoringRules.isTraditional) {
    if (!hasTraditionalProgress) {
      alert("Cannot finalize a match with no tennis score progress. Add points first!");
      return;
    }
    if (isTraditionalMatchComplete(tennisScore, scoringRules)) {
      currentMatch.finishReason = "match-complete";
    } else {
      if (!confirm("This match has not reached its natural conclusion. Finalize the current game and set scores anyway?")) return;
      currentMatch.finishReason = "time-limit";
    }
  } else {
    if (scoreA === 0 && scoreB === 0) {
      alert("Cannot finalize a match with a 0-0 score. Add points first!");
      return;
    }
    if (scoreA === scoreB) {
      alert("Ties are prohibited. Play one deciding rally before finalization!");
      return;
    }
    const reachesTarget = Math.max(scoreA, scoreB) >= scoringRules.pointsToWin && Math.abs(scoreA - scoreB) >= scoringRules.winBy;
    if (!reachesTarget && timerRemainingSeconds > 0) {
      if (!confirm(`Match has not reached ${scoringRules.pointsToWin} points, and the timer is still active. Finalize as a time-limit match anyway?`)) return;
      currentMatch.finishReason = "time-limit";
    } else {
      currentMatch.finishReason = reachesTarget ? "target-score" : "time-limit";
    }
  }
  
  document.getElementById("finalize-modal-teams").textContent = `${currentMatch.teamA.join(" / ")} vs ${currentMatch.teamB.join(" / ")}`;
  document.getElementById("finalize-modal-score").textContent = formatMatchScore(currentMatch);
  document.getElementById("finalize-modal-reason").textContent = scoringRules.isTraditional
    ? (currentMatch.finishReason === "match-complete" ? "Match Complete" : "Time-Limit Tennis Result")
    : (currentMatch.finishReason === "target-score" ? `Target Score of ${scoringRules.pointsToWin} Achieved` : "Time-Limit Termination");
  
  document.getElementById("finalize-modal-overlay").classList.add("active");
}

function closeFinalizeModal() {
  document.getElementById("finalize-modal-overlay").classList.remove("active");
}

function submitFinalization() {
  if (!currentMatch || currentMatch.status === "finalized") return;
  
  currentMatch.status = "finalized";
  currentMatch.finalizedAt = Date.now();
  currentMatch.finalizedBy = currentCourt === "admin" ? "admin" : `Court ${currentCourt}`;
  
  // Reset Timer
  pauseTimer();
  
  saveMatchToDatabase(currentMatch, (success) => {
    if (success) {
      closeFinalizeModal();
      const assigned = autoAssignAvailableCourts();
      alert(assigned.length ? "Official result finalized. Next match is ready on the available court." : "Official result finalized successfully and locked!");
      
      // Progression: Automatically move to next match or waiting state
      updateActiveMatchState();
    } else {
      alert("Failed to save finalization. Please check connection.");
    }
  });
}

// 9. CONFIGURED MATCH TIMER
function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  timerInterval = setInterval(() => {
    if (timerRemainingSeconds > 0) {
      timerRemainingSeconds -= 1;
      updateTimerDisplay();
    } else {
      // Timer Expiry Trigger
      pauseTimer();
      triggerTimeUpNotification();
    }
  }, 1000);
}

function pauseTimer() {
  timerRunning = false;
  if (timerInterval) clearInterval(timerInterval);
}

function resetTimer() {
  pauseTimer();
  timerMatchId = currentMatch?.id || null;
  timerRemainingSeconds = Math.max(1, Number(activeTournament?.settings?.roundDurationMinutes || 8)) * 60;
  updateTimerDisplay();
  const timerValEl = document.getElementById("match-timer-val");
  timerValEl.classList.remove("time-up");
}

function updateTimerDisplay() {
  const min = Math.floor(timerRemainingSeconds / 60).toString().padStart(2, "0");
  const sec = (timerRemainingSeconds % 60).toString().padStart(2, "0");
  const timerValEl = document.getElementById("match-timer-val");
  
  timerValEl.textContent = `${min}:${sec}`;
  
  if (timerRemainingSeconds === 0) {
    timerValEl.classList.add("time-up");
    timerValEl.textContent = "TIME UP";
  } else {
    timerValEl.classList.remove("time-up");
  }
}

function syncTimerForCurrentMatch() {
  const timerContainer = document.querySelector(".timer-container");
  if (!timerContainer) return;
  const duration = Math.max(1, Number(activeTournament?.settings?.roundDurationMinutes || 8));
  const automatic = activeTournament?.settings?.automaticRoundTimer === true;
  timerContainer.classList.toggle("hidden", !currentMatch);
  document.getElementById("match-timer-label").textContent = `${duration}-minute match countdown`;
  document.getElementById("match-timer-mode").textContent = automatic ? "Starts with the first point" : "Start manually when play begins";
  if (timerMatchId !== currentMatch?.id) {
    pauseTimer();
    timerMatchId = currentMatch?.id || null;
    timerRemainingSeconds = duration * 60;
    updateTimerDisplay();
  }
}

function triggerTimeUpNotification() {
  speakWords("Time up! Finish the current rally.");
  
  const scoreA = currentMatch ? currentMatch.teamAScore : 0;
  const scoreB = currentMatch ? currentMatch.teamBScore : 0;
  
  if (scoreA === scoreB) {
    alert("TIME IS UP! The score is tied. Play one deciding rally to determine the winner!");
  } else {
    alert("TIME IS UP! The leading team may now finalize the current score.");
  }
}

// 10. VOICE SPEECH SYNTHESIS
function speakCurrentScore(scoreA, scoreB, scoringTeam) {
  if (!voiceEnabled) return;
  
  // "Team A leads 6 to 4. Team B serving."
  let phrase = "";
  if (scoreA > scoreB) {
    phrase = `Team A leads, ${scoreA} to ${scoreB}.`;
  } else if (scoreB > scoreA) {
    phrase = `Team B leads, ${scoreB} to ${scoreA}.`;
  } else {
    phrase = `Tied at, ${scoreA}.`;
  }
  
  // Calculate serving side
  const totalPoints = scoreA + scoreB;
  const serviceBlock = Math.floor(totalPoints / 2);
  const servingTeam = serviceBlock % 2 === 0 ? "Team A" : "Team B";
  
  phrase += ` ${servingTeam} serving.`;
  
  speakWords(phrase);
}

function speakWords(text) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  
  try {
    // Cancel any ongoing speaking to prevent massive queuing
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.error("Speech Synthesis failed:", e);
  }
}

function testVoiceCall() {
  speakWords("Audio feedback is enabled. Standing by at Court-side.");
}

function toggleVoicePreference() {
  voiceEnabled = !voiceEnabled;
  localStorage.setItem("voice_enabled", voiceEnabled);
  
  const btn = document.getElementById("btn-voice-toggle");
  if (voiceEnabled) {
    btn.textContent = "Voice ON";
    btn.classList.add("active");
    testVoiceCall();
  } else {
    btn.textContent = "Voice OFF";
    btn.classList.remove("active");
  }
}

function loadSavedPreferences() {
  const btn = document.getElementById("btn-voice-toggle");
  if (btn) {
    if (voiceEnabled) {
      btn.textContent = "Voice ON";
      btn.classList.add("active");
    } else {
      btn.textContent = "Voice OFF";
      btn.classList.remove("active");
    }
  }
  
  const leadBtn = document.getElementById("btn-toggle-lead-view");
  if (leadBtn) {
    leadBtn.textContent = leaderboardDetailed ? "Show Compact Standings" : "Show Detailed Stats";
  }
}

// 11. MATCHES DIRECTORY RENDERER
let matchesFilter = "all"; // all, pending, completed

function filterMatches(type) {
  matchesFilter = type;
  const tabs = document.querySelectorAll(".match-filter-tab");
  tabs.forEach(t => t.classList.remove("active"));
  
  const activeTabBtn = document.getElementById(`m-filter-${type}`);
  if (activeTabBtn) activeTabBtn.classList.add("active");
  
  renderMatchesList();
}

function renderMatchesList() {
  const container = document.getElementById("matches-list-container");
  const emptyState = document.getElementById("matches-empty-state");
  
  if (!container) return;
  container.innerHTML = "";
  
  // Filter matches belonging to the selected court (or all if admin)
  let courtMatches = Object.values(matchesCache);
  if (currentCourt !== "admin") {
    courtMatches = courtMatches.filter(m => m.court === currentCourt);
  }
  
  // Apply tab filter
  if (matchesFilter === "pending") {
    courtMatches = courtMatches.filter(m => m.status !== "finalized");
  } else if (matchesFilter === "completed") {
    courtMatches = courtMatches.filter(m => m.status === "finalized");
  }
  
  // Sort: Round first, then Court
  courtMatches.sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    return a.court - b.court;
  });
  
  if (courtMatches.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");
  
  courtMatches.forEach((m) => {
    const isActive = currentMatch && currentMatch.id === m.id;
    const isWinnerA = m.status === "finalized" && m.teamAScore > m.teamBScore;
    const isWinnerB = m.status === "finalized" && m.teamBScore > m.teamAScore;
    
    const card = document.createElement("article");
    card.className = `match-item-card ${isActive ? "active-match" : ""} ${m.status === "finalized" ? "locked" : ""}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    const openCard = () => {
      if (currentCourt === "admin" || m.status !== "finalized") {
        currentMatch = m;
        switchTab("score");
        renderActiveScoreboard();
      } else {
        alert("This match has been finalized and locked. Ask an administrator to reopen if correction is needed.");
      }
    };
    card.onclick = openCard;
    card.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCard();
      }
    };
    
    card.innerHTML = `
      <div class="match-card-top">
        <span>COURT ${m.court} • ROUND ${m.round}</span>
        <span class="match-card-status status-${m.status}">${m.status}</span>
      </div>
      
      <div class="match-card-teams">
        <div class="match-card-team-box">
          <span class="player-small">${escapeMarkup(m.teamA[0])}</span>
          <span class="player-small-sub">${escapeMarkup(m.teamA[1])}</span>
        </div>
        
        <div class="match-card-score-box ${isWinnerA ? "winner-a" : isWinnerB ? "winner-b" : ""}">
          <span>${m.teamAScore}</span>
          <span style="font-size:12px; color:var(--text-muted);">:</span>
          <span>${m.teamBScore}</span>
        </div>
        
        <div class="match-card-team-box right">
          <span class="player-small">${escapeMarkup(m.teamB[0])}</span>
          <span class="player-small-sub">${escapeMarkup(m.teamB[1])}</span>
        </div>
      </div>
      
      <div class="open-match-row">
        <button class="btn-open-match">
          ${m.status === "finalized" ? '<i data-lucide="lock" style="width:12px;"></i> Locked' : '<i data-lucide="chevron-right" style="width:12px;"></i> Score Match'}
        </button>
      </div>
    `;
    
    container.appendChild(card);
  });
  
  initLucide();
}

// 12. INDIVIDUAL LEADERBOARD ENGINE
function toggleLeaderboardDetails() {
  leaderboardDetailed = !leaderboardDetailed;
  localStorage.setItem("leaderboard_detailed", leaderboardDetailed);
  
  const btn = document.getElementById("btn-toggle-lead-view");
  btn.textContent = leaderboardDetailed ? "Show Compact Standings" : "Show Detailed Stats";
  
  renderLeaderboard();
}

function renderLeaderboard() {
  if (Array.isArray(serverLeaderboard)) {
    renderServerLeaderboard(serverLeaderboard);
    return;
  }
  const container = document.getElementById("leaderboard-list-container");
  const emptyState = document.getElementById("leaderboard-empty-state");
  
  if (!container) return;
  container.innerHTML = "";
  
  // Recalculate leaderboard on the fly from matchesCache (No corrupted counts)
  const playerStats = {};
  
  // Gather all unique player names from fixtures to seed player stats (So even players with 0 games show up!)
  for (let courtNum = 1; courtNum <= 4; courtNum++) {
    const courtFixtures = window.FIXTURES[courtNum] || [];
    courtFixtures.forEach((f) => {
      [...f.teamA, ...f.teamB].forEach((pName) => {
        const cleanName = pName.trim();
        if (cleanName && !playerStats[cleanName]) {
          playerStats[cleanName] = {
            name: cleanName,
            games: 0,
            wins: 0,
            losses: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDiff: 0
          };
        }
      });
    });
  }
  
  // Accumulate finalized matches
  const finalizedMatches = Object.values(matchesCache).filter(m => m.status === "finalized");
  
  if (finalizedMatches.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");
  
  finalizedMatches.forEach((m) => {
    const scoreA = m.teamAScore;
    const scoreB = m.teamBScore;
    const isWinA = scoreA > scoreB;
    const isWinB = scoreB > scoreA;
    
    // Team A Players
    m.teamA.forEach((p) => {
      const pName = p.trim();
      if (!playerStats[pName]) return;
      playerStats[pName].games += 1;
      playerStats[pName].pointsFor += scoreA;
      playerStats[pName].pointsAgainst += scoreB;
      if (isWinA) playerStats[pName].wins += 1;
      else if (isWinB) playerStats[pName].losses += 1;
    });
    
    // Team B Players
    m.teamB.forEach((p) => {
      const pName = p.trim();
      if (!playerStats[pName]) return;
      playerStats[pName].games += 1;
      playerStats[pName].pointsFor += scoreB;
      playerStats[pName].pointsAgainst += scoreA;
      if (isWinB) playerStats[pName].wins += 1;
      else if (isWinA) playerStats[pName].losses += 1;
    });
  });
  
  // Post process differences
  const leaderboardArr = Object.values(playerStats);
  leaderboardArr.forEach((p) => {
    p.pointDiff = p.pointsFor - p.pointsAgainst;
  });
  
  // Sorting order:
  // 1. Points For, highest first
  // 2. Wins, highest first
  // 3. Point Difference, highest first
  // 4. Alphabetically
  leaderboardArr.sort((a, b) => {
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    return a.name.localeCompare(b.name);
  });
  
  // Render List
  leaderboardArr.forEach((p, idx) => {
    const rank = idx + 1;
    const card = document.createElement("div");
    card.className = `player-rank-card ${rank === 1 ? "top-1" : rank === 2 ? "top-2" : rank === 3 ? "top-3" : ""}`;
    
    let statsSection = "";
    if (leaderboardDetailed) {
      statsSection = `
        <div class="player-stats-detail-grid">
          <div class="player-detail-stat">
            <span class="player-detail-stat-label">Games</span>
            <span class="player-detail-stat-val">${p.games}</span>
          </div>
          <div class="player-detail-stat" style="border-left:1px solid var(--border-color);">
            <span class="player-detail-stat-label">Wins</span>
            <span class="player-detail-stat-val" style="color:var(--success);">${p.wins}</span>
          </div>
          <div class="player-detail-stat" style="border-left:1px solid var(--border-color);">
            <span class="player-detail-stat-label">Loss</span>
            <span class="player-detail-stat-val" style="color:var(--danger);">${p.losses}</span>
          </div>
          <div class="player-detail-stat" style="border-left:1px solid var(--border-color);">
            <span class="player-detail-stat-label">For</span>
            <span class="player-detail-stat-val">${p.pointsFor}</span>
          </div>
          <div class="player-detail-stat" style="border-left:1px solid var(--border-color);">
            <span class="player-detail-stat-label">Agst</span>
            <span class="player-detail-stat-val">${p.pointsAgainst}</span>
          </div>
          <div class="player-detail-stat" style="border-left:1px solid var(--border-color);">
            <span class="player-detail-stat-label">Diff</span>
            <span class="player-detail-stat-val ${p.pointDiff > 0 ? "text-success" : p.pointDiff < 0 ? "text-danger" : ""}" style="font-family:var(--font-mono);">${p.pointDiff > 0 ? "+" + p.pointDiff : p.pointDiff}</span>
          </div>
        </div>
      `;
    }
    
    card.style.flexDirection = "column";
    card.style.alignItems = "stretch";
    
    card.innerHTML = `
      <div class="player-rank-left" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div class="rank-badge">${rank}</div>
          <div class="player-rank-info">
            <div class="player-rank-name">${p.name}</div>
            <div class="player-rank-stats-summary">${p.wins}W – ${p.losses}L (${p.games} Matches)</div>
          </div>
        </div>
        
        <div class="player-rank-points-badge">
          <span>${p.pointsFor}</span>
          <span>PTS For</span>
        </div>
      </div>
      ${statsSection}
    `;
    
    container.appendChild(card);
  });
}

function renderServerLeaderboard(rows) {
  const container = document.getElementById("leaderboard-list-container");
  const emptyState = document.getElementById("leaderboard-empty-state");
  if (!container) return;
  container.innerHTML = "";
  if (!rows.length) { emptyState?.classList.remove("hidden"); return; }
  emptyState?.classList.add("hidden");
  rows.forEach((row) => {
    const games = Number(row.gamesPlayed || 0);
    const card = document.createElement("div");
    card.className = `player-rank-card ${row.rank === 1 ? "top-1" : row.rank === 2 ? "top-2" : row.rank === 3 ? "top-3" : ""}`;
    card.style.flexDirection = "column";
    card.style.alignItems = "stretch";
    const label = row.player || row.team || "";
    const format = activeTournament?.format || "";
    const primaryPoints = format === "king-of-the-court" ? row.courtPoints || 0 : format === "ladder-league" ? row.ladderPosition || row.rank : format === "americano" || format === "mixed-americano" || format === "mexicano" || format === "custom" ? row.pointsScored || 0 : row.matchPoints || row.wins || 0;
    const primaryLabel = format === "king-of-the-court" ? "COURT PTS" : format === "ladder-league" ? "POSITION" : format === "americano" || format === "mixed-americano" || format === "mexicano" || format === "custom" ? "PTS FOR" : "PTS";
    const statsSection = leaderboardDetailed ? `<div class="player-stats-detail-grid"><div class="player-detail-stat"><span class="player-detail-stat-label">Games</span><span class="player-detail-stat-val">${games}</span></div><div class="player-detail-stat"><span class="player-detail-stat-label">Wins</span><span class="player-detail-stat-val">${row.wins || 0}</span></div><div class="player-detail-stat"><span class="player-detail-stat-label">Loss</span><span class="player-detail-stat-val">${row.losses || 0}</span></div><div class="player-detail-stat"><span class="player-detail-stat-label">For</span><span class="player-detail-stat-val">${row.pointsScored || 0}</span></div><div class="player-detail-stat"><span class="player-detail-stat-label">Agst</span><span class="player-detail-stat-val">${row.pointsConceded || 0}</span></div><div class="player-detail-stat"><span class="player-detail-stat-label">Diff</span><span class="player-detail-stat-val">${row.pointDifference || 0}</span></div></div>` : "";
    card.innerHTML = `<div class="player-rank-left" style="display:flex; justify-content:space-between; align-items:center; width:100%;"><div style="display:flex; align-items:center; gap:12px;"><div class="rank-badge">${row.rank}</div><div class="player-rank-info"><div class="player-rank-name">${label}</div><div class="player-rank-stats-summary">${row.wins || 0}W – ${row.losses || 0}L (${games} Matches)</div></div></div><div class="player-rank-points-badge"><span>${primaryPoints}</span><span>${primaryLabel}</span></div></div>${statsSection}`;
    container.appendChild(card);
  });
}

// 13. ADMINISTRATOR PORTAL & TOOLS
function renderAdminPortal() {
  const completedCount = Object.values(matchesCache).filter(m => m.status === "finalized").length;
  const activeCourts = new Set(Object.values(matchesCache).filter(m => m.status === "active").map(m => m.court)).size;
  
  const createButton = document.getElementById("btn-create-event");
  if (createButton) createButton.classList.toggle("hidden", currentCourt !== "admin");

  document.getElementById("admin-stat-completed").textContent = completedCount;
  document.getElementById("admin-stat-active").textContent = activeCourts;
  document.getElementById("admin-stat-total").textContent = Object.keys(matchesCache).length;
  const eventName = document.getElementById("admin-current-event-name");
  const eventStatus = document.getElementById("admin-current-event-status");
  if (eventName) eventName.textContent = activeTournament?.name || "No active tournament";
  if (eventStatus) eventStatus.textContent = activeTournament?.status || "Inactive";
  const continueButton = document.getElementById("btn-continue-tournament");
  if (continueButton) continueButton.disabled = !activeTournament || activeTournament.status !== "published";
  renderLiveTournamentDashboard();
  
  const tbody = document.getElementById("admin-matches-tbody");
  tbody.innerHTML = "";
  
  const sortedMatches = Object.values(matchesCache);
  sortedMatches.sort((a,b) => {
    if (a.court !== b.court) return a.court - b.court;
    return a.round - b.round;
  });
  
  sortedMatches.forEach((m) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>Court ${m.court}</strong></td>
      <td>R${m.round}</td>
      <td>
        <div style="font-weight:600;">${m.teamA.map(escapeMarkup).join("/")}</div>
        <div style="font-size:14px; color:var(--primary-green); font-family:var(--font-mono);">${m.teamAScore}</div>
      </td>
      <td>
        <div style="font-weight:600;">${m.teamB.map(escapeMarkup).join("/")}</div>
        <div style="font-size:14px; color:var(--primary-green); font-family:var(--font-mono);">${m.teamBScore}</div>
      </td>
      <td>
        <span class="match-card-status status-${m.status}">${m.status}</span>
      </td>
      <td>
        <div style="font-size:10px; font-weight:600;">${m.finalizedBy || "-"}</div>
        <div style="font-size:9px; color:var(--text-muted);">${m.finalizedAt ? new Date(m.finalizedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ""}</div>
      </td>
      <td>
        <div class="admin-table-actions">
          <button class="btn-table-action" onclick="adminEditMatch('${m.id}')">Edit</button>
          ${m.status === "finalized" ? 
            `<button class="btn-table-action danger" onclick="adminReopenMatch('${m.id}')">Reopen</button>` : 
            `<button class="btn-table-action danger" onclick="adminResetMatch('${m.id}')">Reset</button>`
          }
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function adminEditMatch(matchId) {
  const match = matchesCache[matchId];
  if (!match) return;
  
  currentMatch = match;
  openQuickScoreSheet();
}

function adminReopenMatch(matchId) {
  const match = matchesCache[matchId];
  if (!match) return;
  
  if (confirm(`Are you sure you want to REOPEN Court ${match.court} Round ${match.round} match? It will unlock scoring for the referee.`)) {
    match.status = "active";
    match.finalizedAt = null;
    match.finalizedBy = null;
    saveMatchToDatabase(match, (success) => {
      if (success) {
        alert("Match reopened successfully!");
        renderAdminPortal();
      }
    });
  }
}

function adminResetMatch(matchId) {
  const match = matchesCache[matchId];
  if (!match) return;
  
  if (confirm(`Are you sure you want to RESET Court ${match.court} Round ${match.round} match to 0-0? It will wipe scoring history.`)) {
    match.status = "scheduled";
    match.teamAScore = 0;
    match.teamBScore = 0;
    match.scoreHistory = [];
    match.startedAt = null;
    match.finalizedAt = null;
    match.finalizedBy = null;
    match.finishReason = null;
    saveMatchToDatabase(match, (success) => {
      if (success) {
        alert("Match reset successfully!");
        renderAdminPortal();
      }
    });
  }
}

function triggerTournamentReset() {
  if (confirm("CRITICAL WARNING: This will reset all 80 matches across all courts to 0-0. This action is IRREVERSIBLE. Proceed?")) {
    const resetMatches = {};
    for (let courtNum = 1; courtNum <= 4; courtNum++) {
      const courtFixtures = window.FIXTURES[courtNum] || [];
      courtFixtures.forEach((fix) => {
        const matchId = `court${courtNum}_round${fix.round}`;
        resetMatches[matchId] = {
          id: matchId,
          court: courtNum,
          round: fix.round,
          time: fix.time,
          teamA: fix.teamA,
          teamB: fix.teamB,
          teamAScore: 0,
          teamBScore: 0,
          status: "scheduled",
          scoreHistory: [],
          startedAt: null,
          finalizedAt: null,
          finalizedBy: null,
          finishReason: null
        };
      });
    }
    
    setSavingState(true);
    if (!firebaseEnabled) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(resetMatches));
      setSavingState(false);
      onMatchesDataChanged(resetMatches);
      alert("All local matches reset successfully!");
    } else {
      db.ref("matches").set(resetMatches)
        .then(() => {
          setSavingState(false);
          alert("All Firebase database matches reset successfully!");
        })
        .catch((e) => {
          setSavingState(false, true);
          alert("Firebase reset failed.");
        });
    }
  }
}

// Replaced by the shared Postgres bootstrap in production. Keeping a safe
// fallback prevents an admin from mistaking a local demo reset for ending a
// real event.
function triggerEndEvent() {
  alert("Ending an event requires the shared Postgres server connection.");
}

function openTournamentBuilder() {
  workflowIntent = "create";
  switchTab("builder");
  initializeTournamentBuilder();
}

function initializeTournamentBuilder() {
  renderSportChoices();
  setupPresetControls();
  selectSport(builderDraft.sport || "pickleball");
  populateBuilderFormats();
  applyOfficialRulePreset();
  showBuilderStep("sport");
}

const BUILDER_STEPS = ["sport", "event", "format", "count", "players", "details", "match-scoring", "duration", "schedule", "break", "preview", "publish"];
const BUILDER_STEP_NAMES = ["Choose Sport", "Choose Event", "Game Format", "Player Count", "Player Names", "Tournament Name", "Match Format & Scoring", "Match Duration", "Tournament Schedule", "Break Between Rounds", "Review", "Publish"];
window.BUILDER_STEPS = BUILDER_STEPS;
window.BUILDER_STEP_NAMES = BUILDER_STEP_NAMES;
function showBuilderStep(step = "sport") {
  const sectionStep = { event: "type" }[step] || step;
  document.querySelectorAll(".builder-step").forEach((section) => section.classList.toggle("active", section.id === `builder-${sectionStep}-step`));
  const index = Math.max(0, BUILDER_STEPS.indexOf(step));
  document.getElementById("builder-step-count").textContent = `Step ${index + 1} of ${BUILDER_STEPS.length}`;
  document.getElementById("builder-step-name").textContent = BUILDER_STEP_NAMES[index] || "Tournament Builder";
  document.querySelector(".progress-track")?.setAttribute("aria-valuenow", String(index + 1));
  const track = document.querySelector(".progress-track");
  if (track) track.setAttribute("aria-valuemax", String(BUILDER_STEPS.length));
  const bar = document.getElementById("builder-progress-bar");
  if (bar) bar.style.width = `${((index + 1) / BUILDER_STEPS.length) * 100}%`;
  if (step === "publish") renderBuilderPublishSummary();
}
function setupPresetButtons() {
  document.querySelectorAll(".preset-grid").forEach((grid) => {
    if (grid.dataset.ready) return;
    grid.dataset.ready = "true";
    const input = document.getElementById(grid.dataset.presetFor);
    String(grid.dataset.values || "").split(",").forEach((value) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "preset-pill"; button.textContent = grid.dataset.presetFor === "builder-court-count" ? ["①","②","③","④"][Number(value)-1] || value : value;
      button.onclick = () => { input.value = value; input.classList.add("hidden"); grid.querySelectorAll("button").forEach((b) => b.classList.remove("active")); button.classList.add("active"); };
      grid.appendChild(button);
      if (input && input.value === value) button.classList.add("active");
    });
    if (grid.dataset.custom === "true") {
      const custom = document.createElement("button"); custom.type = "button"; custom.className = "preset-pill"; custom.textContent = "Custom";
      custom.onclick = () => { input.classList.remove("hidden"); input.focus(); grid.querySelectorAll("button").forEach((b) => b.classList.remove("active")); custom.classList.add("active"); };
      grid.appendChild(custom);
    }
  });
}
function renderSportChoices() {
  const target = document.getElementById("builder-sport-options"); if (!target) return;
  target.innerHTML = Object.entries(SPORT_RULE_PRESETS).map(([id, sport]) => `<button class="choice-card" data-sport="${id}" onclick="selectSport('${id}')"><strong>${sport.name}</strong><small>Official preset + supported events</small></button>`).join("");
}
function selectSport(sport) {
  if (!SPORT_RULE_PRESETS[sport]) return;
  const previousSport = builderDraft.sport;
  builderDraft.sport = sport;
  if (previousSport !== sport) builderDraft.scoringFormat = ["tennis", "padel"].includes(sport) ? "traditional-tennis" : "points";
  document.querySelectorAll("[data-sport]").forEach((button) => button.classList.toggle("selected", button.dataset.sport === sport));
  document.getElementById("builder-sport-continue").disabled = false;
  renderEventChoices(); applyOfficialRulePreset();
}
function renderEventChoices() {
  const stack = document.querySelector("#builder-type-step .choice-stack"); if (!stack) return;
  const sport = SPORT_RULE_PRESETS[builderDraft.sport] || SPORT_RULE_PRESETS.pickleball;
  if (!sport.events.includes(builderDraft.tournamentType)) builderDraft.tournamentType = sport.events[0];
  stack.innerHTML = sport.events.map((event) => `<button class="choice-card ${builderDraft.tournamentType === event ? "selected" : ""}" data-tournament-type="${event}" onclick="selectTournamentType('${event}')"><strong>${EVENT_LABELS[event] || event}</strong><small>${sport.name} event</small></button>`).join("");
  const continueButton = document.getElementById("builder-type-continue");
  if (continueButton) continueButton.disabled = false;
}
function selectTournamentType(type = "mixed-doubles") {
  builderDraft.tournamentType = type;
  document.querySelectorAll("[data-tournament-type]").forEach((button) => button.classList.toggle("selected", button.dataset.tournamentType === type));
  document.getElementById("builder-type-continue").disabled = false;
}
function continueTournamentType() { showBuilderStep("format"); }
function applyOfficialRulePreset() {
  const sport = SPORT_RULE_PRESETS[builderDraft.sport] || SPORT_RULE_PRESETS.pickleball;
  if (["tennis", "padel"].includes(builderDraft.sport) && !builderDraft.scoringFormat) builderDraft.scoringFormat = "traditional-tennis";
  if (!["tennis", "padel"].includes(builderDraft.sport)) builderDraft.scoringFormat = "points";
  builderDraft.ruleConfiguration = { mode: builderDraft.scoringMode || "official", sport: builderDraft.sport, scoringFormat: builderDraft.scoringFormat, ...sport.defaults };
  const points = document.getElementById("builder-points-to-win"); if (points && sport.defaults.targetScore) points.value = sport.defaults.targetScore;
  const winBy = document.getElementById("builder-win-by"); if (winBy && sport.defaults.winBy) winBy.value = sport.defaults.winBy;
  renderScoringConfiguration();
}
function updateScoringMode() { builderDraft.scoringMode = document.querySelector('input[name="builder-scoring-mode"]:checked')?.value || "official"; renderScoringConfiguration(); }
function updateBuilderScoringFormat() {
  builderDraft.scoringFormat = document.querySelector('input[name="builder-scoring-format"]:checked')?.value || "points";
  renderScoringConfiguration();
}
function renderScoringConfiguration() {
  const sport = SPORT_RULE_PRESETS[builderDraft.sport] || SPORT_RULE_PRESETS.pickleball;
  const scoringOptions = document.getElementById("builder-scoring-format-options");
  const pointFields = document.getElementById("builder-point-scoring-fields");
  const traditionalFields = document.getElementById("builder-traditional-scoring-fields");
  const usesTraditionalOption = ["tennis", "padel"].includes(builderDraft.sport);
  if (scoringOptions) {
    scoringOptions.classList.toggle("hidden", !usesTraditionalOption);
    scoringOptions.innerHTML = usesTraditionalOption ? `
      <label class="radio-card"><input type="radio" name="builder-scoring-format" value="traditional-tennis" ${builderDraft.scoringFormat !== "points" ? "checked" : ""} onchange="updateBuilderScoringFormat()" /><span><strong>Traditional Tennis</strong><small>0, 15, 30, 40, Deuce & Advantage</small></span></label>
      <label class="radio-card"><input type="radio" name="builder-scoring-format" value="points" ${builderDraft.scoringFormat === "points" ? "checked" : ""} onchange="updateBuilderScoringFormat()" /><span><strong>Points</strong><small>Use a target score and winning margin.</small></span></label>` : "";
  }
  if (!usesTraditionalOption) builderDraft.scoringFormat = "points";
  if (builderDraft.sport === "padel" && document.getElementById("builder-tennis-sets")?.value === "5") document.getElementById("builder-tennis-sets").value = "3";
  document.querySelector('#builder-tennis-sets option[value="5"]')?.classList.toggle("hidden", builderDraft.sport === "padel");
  if (pointFields) pointFields.classList.toggle("hidden", usesTraditionalOption && builderDraft.scoringFormat !== "points");
  if (traditionalFields) traditionalFields.classList.toggle("hidden", !usesTraditionalOption || builderDraft.scoringFormat === "points");
  const summary = document.getElementById("official-rules-summary");
  if (summary) summary.innerHTML = `<strong>${sport.name} official preset</strong><p>${Object.entries(sport.defaults).map(([k,v]) => `${k}: ${v ?? "none"}`).join(" · ")}</p>`;
  const common = document.getElementById("scoring-common-settings");
  if (common) common.innerHTML = sport.editable.slice(0, 5).map((key) => `<label class="setup-field"><span>${key.replace(/([A-Z])/g, " $1")}</span><input class="form-input" data-rule-key="${key}" value="${sport.defaults[key] ?? ""}" /></label>`).join("");
  document.getElementById("scoring-advanced-settings")?.classList.toggle("hidden", builderDraft.scoringMode !== "custom");
  const advanced = document.getElementById("scoring-advanced-content");
  if (advanced) advanced.innerHTML = Object.keys(sport.defaults).map((key) => `<label class="setup-field"><span>${key.replace(/([A-Z])/g, " $1")}</span><input class="form-input" data-rule-key="${key}" value="${sport.defaults[key] ?? ""}" /></label>`).join("");
}
function collectRuleInputs() {
  const sport = SPORT_RULE_PRESETS[builderDraft.sport] || SPORT_RULE_PRESETS.pickleball;
  const rules = { mode: builderDraft.scoringMode || "official", sport: builderDraft.sport, scoringFormat: builderDraft.scoringFormat || "points", ...sport.defaults };
  if (["tennis", "padel"].includes(builderDraft.sport) && builderDraft.scoringFormat !== "points") {
    const tieBreakValue = document.getElementById("builder-tiebreak")?.value || "6-6";
    rules.scoringFormat = "traditional-tennis";
    rules.scoringSystem = "traditional-tennis";
    rules.sets = Number(document.getElementById("builder-tennis-sets")?.value || 3);
    rules.gamesPerSet = Number(document.getElementById("builder-games-per-set")?.value || 6);
    rules.tieBreak = tieBreakValue !== "none";
    rules.tieBreakAt = tieBreakValue === "6-6" ? "6-6" : null;
    rules.finalSetSuperTieBreak = tieBreakValue === "final-set-super";
  } else {
    rules.scoringFormat = "points";
    rules.targetScore = Number(document.getElementById("builder-points-to-win")?.value || sport.defaults.targetScore || 15);
    rules.winBy = Number(document.getElementById("builder-win-by")?.value || sport.defaults.winBy || 1);
  }
  document.querySelectorAll("#scoring-common-settings [data-rule-key], #scoring-advanced-content [data-rule-key]").forEach((input) => {
    const key = input.dataset.ruleKey;
    if (!key) return;
    const raw = input.value;
    if (raw === "true" || raw === "false") rules[key] = raw === "true";
    else if (raw === "") rules[key] = null;
    else if (!Number.isNaN(Number(raw)) && raw.trim() !== "") rules[key] = Number(raw);
    else rules[key] = raw;
  });
  return rules;
}
function collectBuilderDraft() {
  builderDraft.name = document.getElementById("builder-name")?.value?.trim() || "Untitled Tournament";
  builderDraft.playerCount = Math.max(4, Number(document.getElementById("builder-player-count")?.value || 16));
  builderDraft.numberOfCourts = Math.max(1, Number(document.getElementById("builder-court-count")?.value || 1));
  builderDraft.roundCount = Math.max(1, Number(document.getElementById("builder-round-count")?.value || Math.ceil(builderDraft.playerCount / 4)));
  builderDraft.roundGapMinutes = Math.max(0, Number(document.getElementById("builder-round-gap")?.value || 0));
  builderDraft.roundDurationMinutes = Number(document.getElementById("builder-match-duration")?.value || 8);
  const usesTraditionalScoring = ["tennis", "padel"].includes(builderDraft.sport) && builderDraft.scoringFormat !== "points";
  builderDraft.pointsToWin = usesTraditionalScoring ? 0 : Number(document.getElementById("builder-points-to-win")?.value || builderDraft.ruleConfiguration?.targetScore || 11);
  builderDraft.winBy = usesTraditionalScoring ? 0 : Number(document.getElementById("builder-win-by")?.value || builderDraft.ruleConfiguration?.winBy || 2);
  builderDraft.date = document.getElementById("builder-date")?.value || "";
  builderDraft.startTime = document.getElementById("builder-start-time")?.value || "11:00";
  builderDraft.location = document.getElementById("builder-location")?.value?.trim() || "";
  builderDraft.format = document.getElementById("builder-format")?.value || "round-robin";
  builderDraft.ruleConfiguration = collectRuleInputs();
  builderDraft.scoringFormat = builderDraft.ruleConfiguration.scoringFormat;
  return builderDraft;
}
function preparePlayerNamesStep() {
  collectBuilderDraft();
  if (!Number.isInteger(builderDraft.playerCount) || builderDraft.playerCount < 4 || builderDraft.playerCount % 2 !== 0) {
    const message = document.getElementById("builder-message");
    if (message) { message.textContent = "Player count must be a valid even number."; message.classList.remove("hidden"); }
    return;
  }
  const grid = document.getElementById("builder-player-grid");
  if (grid) {
    const existing = Array.from(grid.querySelectorAll("input")).map((input) => input.value);
    grid.innerHTML = Array.from({ length: builderDraft.playerCount }, (_, index) => `<label class="setup-field"><span>Player ${index + 1}</span><input class="form-input builder-player-name" value="${escapeMarkup(existing[index] || `Player ${index + 1}`)}" /></label>`).join("");
  }
  showBuilderStep("players");
}
function saveTournamentConfiguration() { collectBuilderDraft(); renderBuilderReview(); showBuilderStep("preview"); }
function saveTournamentPlayers() { builderDraft.players = Array.from(document.querySelectorAll(".builder-player-name")).map((input, index) => input.value.trim() || `Player ${index + 1}`); populateBuilderFormats(); showBuilderStep("details"); }
function populateBuilderFormats() { const select = document.getElementById("builder-format"); if (select && !select.options.length) (window.TOURNAMENT_FORMATS || ["round-robin", "single-elimination", "americano", "mexicano", "king-of-the-court", "ladder-league"]).forEach((f) => select.add(new Option(f.replace(/-/g, " "), f))); }
function showFormatInformation() { const info = document.getElementById("format-info-content"); if (info) info.textContent = `Selected format: ${document.getElementById("builder-format")?.value || "round-robin"}`; }
function confirmTournamentFormat() { collectBuilderDraft(); showBuilderStep("count"); }
function formatDraftTime(roundIndex) {
  const [hours = 11, minutes = 0] = String(builderDraft.startTime || "11:00").split(":").map(Number);
  const date = new Date(2000, 0, 1, hours, minutes + roundIndex * (builderDraft.roundDurationMinutes + builderDraft.roundGapMinutes));
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function rotatePlayers(players, round) {
  if (!players.length) return [];
  const offset = round % players.length;
  return [...players.slice(offset), ...players.slice(0, offset)];
}
function buildDraftMatches() {
  collectBuilderDraft();
  const players = builderDraft.players?.length ? builderDraft.players : Array.from({ length: builderDraft.playerCount }, (_, i) => `Player ${i + 1}`);
  const matches = {};
  const courts = builderDraft.numberOfCourts;
  const singles = String(builderDraft.tournamentType || "").includes("singles");
  let matchNumber = 1;
  for (let round = 1; round <= builderDraft.roundCount; round += 1) {
    const ordered = rotatePlayers(players, round - 1);
    const playersPerMatch = singles ? 2 : 4;
    const maxMatchesThisRound = Math.min(courts, Math.floor(ordered.length / playersPerMatch));
    for (let courtIndex = 0; courtIndex < maxMatchesThisRound; courtIndex += 1) {
      const group = ordered.slice(courtIndex * playersPerMatch, courtIndex * playersPerMatch + playersPerMatch);
      if (group.length < playersPerMatch) continue;
      const id = `draft-${matchNumber}`;
      const midpoint = singles ? 1 : 2;
      matches[id] = { id, court: courtIndex + 1, round, time: formatDraftTime(round - 1), teamA: group.slice(0, midpoint), teamB: group.slice(midpoint), teamAScore: 0, teamBScore: 0, status: "scheduled", assignmentStatus: round === 1 ? "next-ready" : "waiting", sport: builderDraft.sport, scoringFormat: builderDraft.scoringFormat, ruleConfiguration: builderDraft.ruleConfiguration, pointsToWin: builderDraft.pointsToWin, winBy: builderDraft.winBy, tennisScore: builderDraft.scoringFormat === TRADITIONAL_SCORING_FORMAT ? { pointA: 0, pointB: 0, gamesA: 0, gamesB: 0, setsA: 0, setsB: 0, completedSets: [] } : null, scoreHistory: [], startedAt: null, finalizedAt: null, finalizedBy: null, finishReason: null };
      matchNumber += 1;
    }
  }
  return matches;
}
function renderBuilderReview() {
  const matches = buildDraftMatches();
  const summary = document.getElementById("builder-preview-summary");
  if (summary) summary.textContent = `${builderDraft.name} · ${SPORT_RULE_PRESETS[builderDraft.sport]?.name || builderDraft.sport} · ${EVENT_LABELS[builderDraft.tournamentType] || builderDraft.tournamentType} · ${builderDraft.playerCount} players · ${builderDraft.numberOfCourts} courts · ${Object.keys(matches).length} matches`;
  const list = document.getElementById("builder-preview-list");
  if (list) list.innerHTML = Object.values(matches).map((m) => `<div class="fixture-preview-card"><strong>Round ${m.round} · Court ${m.court} · ${escapeMarkup(m.time)}</strong><span>${escapeMarkup(m.teamA.join(" / "))} vs ${escapeMarkup(m.teamB.join(" / "))}</span></div>`).join("") || `<div class="empty-state">Add enough players to preview fixtures.</div>`;
  return matches;
}
function renderBuilderPublishSummary() {
  const matches = renderBuilderReview();
  const summary = document.getElementById("builder-publish-summary");
  if (summary) summary.innerHTML = `<strong>${escapeMarkup(builderDraft.name || "Untitled Tournament")}</strong><p>${Object.keys(matches).length} matches will be published for ${escapeMarkup(SPORT_RULE_PRESETS[builderDraft.sport]?.name || builderDraft.sport)}.</p>`;
}
function generateBuilderFixtures() { renderBuilderReview(); showBuilderStep("preview"); }
function publishBuilderTournament() {
  const matches = buildDraftMatches();
  activeTournament = { id: `local-${Date.now()}`, name: builderDraft.name, sport: builderDraft.sport, event: builderDraft.tournamentType, format: builderDraft.format, numberOfCourts: builderDraft.numberOfCourts, pointsToWin: builderDraft.pointsToWin, winBy: builderDraft.winBy, status: "published", settings: { sport: builderDraft.sport, scoringFormat: builderDraft.scoringFormat, numberOfRounds: builderDraft.roundCount, roundDurationMinutes: builderDraft.roundDurationMinutes, intervalMinutes: builderDraft.roundGapMinutes, winBy: builderDraft.winBy, ruleConfiguration: builderDraft.ruleConfiguration } };
  matchesCache = matches;
  if (!firebaseEnabled) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(matches));
    localStorage.setItem("aceo_active_tournament", JSON.stringify(activeTournament));
  }
  onMatchesDataChanged(matches);
  const summary = document.getElementById("builder-publish-summary");
  if (summary) summary.innerHTML = `<strong>${escapeMarkup(activeTournament.name)} published.</strong><p>${Object.keys(matches).length} matches are ready for referee devices.</p>`;
  showBuilderStep("publish");
}
function openPlayersPage() {
  switchTab("players");
  const grid = document.getElementById("players-directory-grid");
  if (!grid) return;
  const names = allPlayerNamesFromMatches();
  const fallback = Array.from({ length: 20 }, (_, index) => `Player ${index + 1}`);
  const players = names.length ? names : fallback;
  grid.innerHTML = players.map((name, index) => `<label class="setup-field"><span>Player ${index + 1}</span><input class="form-input player-directory-name" data-original-name="${escapeMarkup(name)}" value="${escapeMarkup(name)}" /></label>`).join("");
}
function savePlayerDirectory() {
  const inputs = Array.from(document.querySelectorAll(".player-directory-name"));
  inputs.forEach((input) => {
    const original = input.dataset.originalName;
    const updated = input.value.trim();
    if (!original || !updated || original === updated) return;
    Object.values(matchesCache).forEach((match) => {
      match.teamA = (match.teamA || []).map((name) => name === original ? updated : name);
      match.teamB = (match.teamB || []).map((name) => name === original ? updated : name);
    });
  });
  if (!firebaseEnabled) localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(matchesCache));
  onMatchesDataChanged(matchesCache);
  alert("Player names saved.");
}
function editTournamentDraft() {}
function archiveTournamentById() {}

function allPlayerNamesFromMatches() {
  return [...new Set(Object.values(matchesCache).flatMap((match) => [...(match.teamA || match.team_a || []), ...(match.teamB || match.team_b || [])]))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}
function openPlayerSchedules() {
  switchTab("player-schedules");
  const select = document.getElementById("player-schedule-select");
  if (!select) return;
  const players = allPlayerNamesFromMatches();
  select.innerHTML = players.map((name) => `<option value="${escapeMarkup(name)}">${escapeMarkup(name)}</option>`).join("");
  renderSelectedPlayerSchedule();
}
function playerMatchRole(match, player) {
  const teamA = match.teamA || match.team_a || []; const teamB = match.teamB || match.team_b || [];
  const onA = teamA.includes(player); const own = onA ? teamA : teamB; const opponents = onA ? teamB : teamA;
  return { partner: own.filter((name) => name !== player).join(" / ") || "Singles", opponents: opponents.join(" / "), onA };
}
function buildPlayerScheduleText(player) {
  const tournamentName = activeTournament?.name || "Tournament";
  const matches = Object.values(matchesCache).filter((m) => [...(m.teamA || m.team_a || []), ...(m.teamB || m.team_b || [])].includes(player)).sort((a,b) => Number(a.round)-Number(b.round) || Number(a.court)-Number(b.court));
  return [`${player}`, `Tournament: ${tournamentName}`, "", ...matches.map((match) => { const role = playerMatchRole(match, player); const score = match.status === "finalized" ? `Final score: ${match.teamAScore || 0}-${match.teamBScore || 0}` : `Estimated start: ${match.time || match.scheduled_time || "TBD"}`; return `Round ${match.round} · Court ${match.court}
${score}
Partner: ${role.partner}
Opponents: ${role.opponents}
Status: ${match.status || "waiting"}`; })].join("\n\n");
}
function renderSelectedPlayerSchedule() {
  const player = document.getElementById("player-schedule-select")?.value; const card = document.getElementById("player-schedule-card"); if (!player || !card) return;
  const matches = Object.values(matchesCache).filter((m) => [...(m.teamA || m.team_a || []), ...(m.teamB || m.team_b || [])].includes(player)).sort((a,b) => Number(a.round)-Number(b.round) || Number(a.court)-Number(b.court));
  card.innerHTML = `<div class="player-schedule-hero"><div><h4>${escapeMarkup(player)}</h4><p>Tournament: ${escapeMarkup(activeTournament?.name || "Current Tournament")}</p></div><button class="btn btn-primary sticky-share" onclick="sharePlayerSchedule('${escapeMarkup(player)}')"><i data-lucide="share-2"></i> Share</button></div>${matches.map((match) => { const role = playerMatchRole(match, player); const finalized = match.status === "finalized"; const won = finalized && ((role.onA && Number(match.teamAScore) > Number(match.teamBScore)) || (!role.onA && Number(match.teamBScore) > Number(match.teamAScore))); return `<article class="itinerary-card"><div class="itinerary-topline"><strong>Round ${match.round}</strong><span class="match-card-status status-${match.status || "scheduled"}">${match.status || "waiting"}</span></div><div class="itinerary-court">Court ${match.court}</div><div class="itinerary-time">${match.time || match.scheduled_time || "Waiting for previous matches"}</div><dl><dt>Partner</dt><dd>${escapeMarkup(role.partner)}</dd><dt>Opponents</dt><dd>${escapeMarkup(role.opponents)}</dd>${finalized ? `<dt>Final score</dt><dd>${match.teamAScore || 0}-${match.teamBScore || 0} · ${won ? "Won" : "Lost"}</dd><dt>Completed</dt><dd>${match.finalizedAt ? new Date(match.finalizedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : "Completed"}</dd>` : ""}</dl></article>`; }).join("") || `<div class="empty-state">No scheduled matches for this player yet.</div>`}`;
  initLucide();
}
async function sharePlayerSchedule(player) {
  const text = buildPlayerScheduleText(player);
  if (navigator.share) return navigator.share({ title: `${player} schedule`, text }).catch(() => navigator.clipboard?.writeText(text));
  await navigator.clipboard?.writeText(text); alert("Player schedule copied to clipboard.");
}

// 14. REPORT CSV EXPORT
function downloadMatchesCSV() {
  const matches = Object.values(matchesCache);
  matches.sort((a, b) => a.court - b.court || a.round - b.round);
  
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Match ID,Court,Round,Time,Team A Players,Team B Players,Score Team A,Score Team B,Status,Finished Reason,Finalized By,Finalized At\r\n";
  
  matches.forEach((m) => {
    const finalizedTime = m.finalizedAt ? new Date(m.finalizedAt).toLocaleString() : "";
    const row = [
      m.id,
      `Court ${m.court}`,
      `Round ${m.round}`,
      m.time,
      `"${m.teamA.join(" / ")}"`,
      `"${m.teamB.join(" / ")}"`,
      m.teamAScore,
      m.teamBScore,
      m.status,
      m.finishReason || "",
      m.finalizedBy || "",
      finalizedTime
    ].join(",");
    csvContent += row + "\r\n";
  });
  
  triggerCSVDownload(csvContent, "pickleball_social_matches_report.csv");
}

function downloadLeaderboardCSV() {
  const rows = Array.isArray(serverLeaderboard) ? serverLeaderboard : [];
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Rank,Player or Team,Games Played,Wins,Losses,Points For,Points Against,Point Difference,Match Points,Buchholz,Strength of Schedule\r\n";
  rows.forEach((row) => {
    const label = row.player || row.team || "";
    const csvRow = [
      row.rank || "",
      `"${String(label).replace(/"/g, '""')}"`,
      row.gamesPlayed || 0,
      row.wins || 0,
      row.losses || 0,
      row.pointsScored || 0,
      row.pointsConceded || 0,
      row.pointDifference || 0,
      row.matchPoints || 0,
      row.buchholz || 0,
      row.strengthOfSchedule || 0,
    ].join(",");
    csvContent += `${csvRow}\r\n`;
  });
  triggerCSVDownload(csvContent, "pickleball_social_leaderboard.csv");
}

function triggerCSVDownload(content, filename) {
  const encodedUri = encodeURI(content);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 15. SETUP EVENTS
function setupEventListeners() {
  // Support iOS PIN field jumps
  const pinInput = document.getElementById("court-pin-input");
  if (pinInput) {
    pinInput.addEventListener("input", (e) => {
      if (pinInput.value.length === 4) {
        submitPinLogin();
      }
    });
  }
}

// Admin Passcode prompt fallback
function validateAdminPasscode() {
  const code = document.getElementById("admin-passcode-input").value;
  const errorEl = document.getElementById("admin-passcode-error");
  
  if (code === "9999" || code === "2026") {
    loginSuccess("admin", "demo_admin_uid");
    closeAdminGate();
  } else {
    errorEl.classList.remove("hidden");
  }
}

function closeAdminGate() {
  document.getElementById("admin-modal-overlay").classList.remove("active");
}

// 16. MOBILE WIZARD PRESETS, LIVE DASHBOARD, AND COURT AUTOMATION
function startDashboardFlow() {
  workflowIntent = "dashboard";
  startAdminAuthentication("Tournament Dashboard");
}

function setupPresetControls() {
  document.querySelectorAll(".preset-grid[data-preset-for]").forEach((grid) => {
    if (grid.dataset.ready === "true") return;
    const input = document.getElementById(grid.dataset.presetFor);
    if (!input) return;
    const values = String(grid.dataset.values || "").split(",").map((value) => value.trim()).filter(Boolean);
    const buttonLabel = (value) => grid.dataset.presetFor === "builder-court-count" ? (["①", "②", "③", "④"][Number(value) - 1] || value) : value;
    const renderActive = () => {
      grid.querySelectorAll(".preset-button").forEach((button) => {
        const active = button.dataset.value === input.value && button.dataset.custom !== "true" && input.classList.contains("hidden");
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    };
    values.forEach((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preset-button";
      button.dataset.value = value;
      button.setAttribute("aria-pressed", "false");
      button.textContent = buttonLabel(value);
      button.addEventListener("click", () => {
        input.value = value;
        input.classList.add("hidden");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        renderActive();
      });
      grid.appendChild(button);
    });
    if (grid.dataset.custom === "true") {
      const custom = document.createElement("button");
      custom.type = "button";
      custom.className = "preset-button";
      custom.dataset.custom = "true";
      custom.textContent = "Custom";
      custom.setAttribute("aria-pressed", "false");
      custom.addEventListener("click", () => {
        input.classList.remove("hidden");
        input.focus();
        grid.querySelectorAll(".preset-button").forEach((button) => {
          button.classList.toggle("active", button === custom);
          button.setAttribute("aria-pressed", String(button === custom));
        });
      });
      grid.appendChild(custom);
    }
    input.addEventListener("input", renderActive);
    grid.dataset.ready = "true";
    renderActive();
  });
}

function getMatchPlayers(match) {
  return [...(match.teamA || []), ...(match.teamB || [])].filter(Boolean);
}

function findNextEligibleMatchForCourt(court, matches = Object.values(matchesCache)) {
  const busyPlayers = new Set(matches.filter((match) => match.status === "active").flatMap(getMatchPlayers));
  return matches
    .filter((match) => match.status === "scheduled")
    .sort((a, b) => Number(a.round) - Number(b.round) || Number(a.court) - Number(b.court))
    .find((match) => !getMatchPlayers(match).some((player) => busyPlayers.has(player)) && (match.court === court || !matches.some((other) => other.court === court && other.status === "active")));
}

function autoAssignAvailableCourts() {
  const matches = Object.values(matchesCache);
  const courts = [...new Set(matches.map((match) => Number(match.court)).filter(Boolean))].sort((a, b) => a - b);
  const updates = [];
  courts.forEach((court) => {
    const hasActive = matches.some((match) => Number(match.court) === court && match.status === "active");
    if (hasActive) return;
    const next = findNextEligibleMatchForCourt(court, matches);
    if (next && next.court !== court) {
      next.court = court;
      next.assignmentStatus = "next-ready";
      updates.push(next);
    } else if (next) {
      next.assignmentStatus = "next-ready";
      updates.push(next);
    }
  });
  updates.forEach((match) => saveMatchToDatabase(match));
  return updates;
}

function renderLiveTournamentDashboard() {
  const matches = Object.values(matchesCache);
  const total = matches.length;
  const completed = matches.filter((match) => match.status === "finalized").length;
  const active = matches.filter((match) => match.status === "active").length;
  const waiting = matches.filter((match) => match.status !== "finalized" && match.status !== "active").length;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  const duration = Number(activeTournament?.settings?.roundDurationMinutes || 8) + Number(activeTournament?.settings?.intervalMinutes || 0);
  const remainingWaves = Math.ceil(waiting / Math.max(1, Number(activeTournament?.numberOfCourts || new Set(matches.map((m) => m.court)).size || 1)));
  const eta = waiting ? `${Math.max(1, remainingWaves * duration)}m` : "Done";
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  setText("admin-stat-waiting", waiting);
  setText("admin-stat-progress", `${progress}%`);
  setText("admin-stat-eta", eta);
  const grid = document.getElementById("court-status-grid");
  if (grid) {
    const courts = [...new Set(matches.map((match) => Number(match.court)).filter(Boolean))].sort((a, b) => a - b);
    grid.innerHTML = courts.map((court) => {
      const current = matches.find((match) => Number(match.court) === court && match.status === "active");
      const next = findNextEligibleMatchForCourt(court, matches);
      return `<div class="court-status-card"><strong>Court ${court}: ${current ? "In play" : "Available"}</strong><small>${current ? `${escapeMarkup(current.teamA.join(" / "))} vs ${escapeMarkup(current.teamB.join(" / "))}` : next ? `Next: ${escapeMarkup(next.teamA.join(" / "))} vs ${escapeMarkup(next.teamB.join(" / "))}` : "No eligible match waiting"}</small></div>`;
    }).join("");
  }
  const ready = document.getElementById("next-match-ready-card");
  if (ready) {
    const nextReady = matches.find((match) => match.assignmentStatus === "next-ready" && match.status !== "finalized") || matches.find((match) => match.status === "scheduled");
    ready.classList.toggle("hidden", !nextReady);
    if (nextReady) ready.innerHTML = `<div class="ready-title">Court ${nextReady.court} Available — Next Match Ready</div><div class="ready-teams">${escapeMarkup(nextReady.teamA.join(" / "))}<br>vs<br>${escapeMarkup(nextReady.teamB.join(" / "))}</div><small>Waiting to be announced</small>`;
  }
}

window.addEventListener("DOMContentLoaded", setupPresetControls);
