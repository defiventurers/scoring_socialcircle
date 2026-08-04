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

// Settings and Preferences (Sync with LocalStorage)
let voiceEnabled = localStorage.getItem("voice_enabled") !== "false"; // default true
let leaderboardDetailed = localStorage.getItem("leaderboard_detailed") === "true"; // default false

// Timer state
let timerInterval = null;
let timerRemainingSeconds = 8 * 60; // 8 minutes
let timerRunning = false;

// Local Demo Database Store (for fallback)
const LOCAL_STORAGE_KEY = "pickleball_social_matches";
const LOCAL_USERS_KEY = "pickleball_social_court_users";

// Initialize Application
window.addEventListener("DOMContentLoaded", () => {
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

// Initialize Icons
function initLucide() {
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
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
      if (!parsed || typeof parsed !== "object" || Object.keys(parsed).length !== 80) {
        shouldSeed = true;
      }
    } catch (e) {
      shouldSeed = true;
    }
  } else {
    shouldSeed = true;
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
  } else if (parsed) {
    // Self-healing: Update names or times if fixtures.js was corrected
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
  document.getElementById("selected-court-title").textContent = `Court ${num} Selected`;
  document.getElementById("login-step-court").classList.add("hidden");
  document.getElementById("login-step-pin").classList.remove("hidden");
  document.getElementById("court-pin-input").value = "";
  document.getElementById("court-pin-input").focus();
  document.getElementById("login-error").classList.add("hidden");
}

function goBackToCourts() {
  document.getElementById("login-step-pin").classList.add("hidden");
  document.getElementById("login-step-court").classList.remove("hidden");
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
  const pinInput = document.getElementById("court-pin-input");
  currentCourt = "admin";
  document.getElementById("selected-court-title").textContent = `Admin Access Portal`;
  document.getElementById("login-step-court").classList.add("hidden");
  document.getElementById("login-step-pin").classList.remove("hidden");
  pinInput.value = "";
  pinInput.focus();
}

// Logged in successfully
function loginSuccess(court, userId) {
  // Save credentials locally
  localStorage.setItem("saved_court", court);
  localStorage.setItem("saved_uid", userId);
  
  currentCourt = court;
  
  // Update header titles
  const titleEl = document.getElementById("referee-court-title");
  if (court === "admin") {
    titleEl.textContent = "ADMINISTRATOR PORTAL";
    document.getElementById("tab-btn-admin").classList.remove("hidden");
    document.getElementById("desktop-admin-nav").classList.remove("hidden");
  } else {
    titleEl.textContent = `COURT ${court} REFEREE`;
    document.getElementById("tab-btn-admin").classList.add("hidden");
    document.getElementById("desktop-admin-nav").classList.add("hidden");
  }
  
  // Auto switch screen
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("dashboard-screen").classList.remove("hidden");
  
  // Auto open Score tab
  switchTab("score");
  
  // Run recalculations
  onMatchesDataChanged(matchesCache);
}

function checkAutologin() {
  const savedCourt = localStorage.getItem("saved_court");
  const savedUid = localStorage.getItem("saved_uid");
  
  if (savedCourt && savedUid) {
    if (savedCourt === "admin") {
      loginSuccess("admin", savedUid);
    } else {
      loginSuccess(parseInt(savedCourt), savedUid);
    }
  }
}

function logoutSession() {
  if (firebaseEnabled) {
    firebase.auth().signOut().catch(e => console.error(e));
  }
  
  // Clear storage
  localStorage.removeItem("saved_court");
  localStorage.removeItem("saved_uid");
  
  currentCourt = null;
  currentMatch = null;
  
  // Hide UI
  document.getElementById("dashboard-screen").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("login-step-pin").classList.add("hidden");
  document.getElementById("login-step-court").classList.remove("hidden");
  
  // Stop timer
  pauseTimer();
}

// 4. TAB NAVIGATION & VIEWS
function switchTab(tabId) {
  activeTab = tabId;
  
  // Update Mobile Navigation Buttons
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.classList.remove("active");
  });
  
  const activeBtn = document.getElementById(`tab-btn-${tabId}`);
  if (activeBtn) activeBtn.classList.add("active");
  
  // Update Desktop Navigation Header Buttons
  const deskButtons = document.querySelectorAll(".desktop-nav-btn");
  deskButtons.forEach((btn) => {
    btn.classList.remove("active");
    if (btn.textContent.toLowerCase() === tabId) {
      btn.classList.add("active");
    }
  });

  // Switch visible panel
  const panels = document.querySelectorAll(".tab-panel");
  panels.forEach((p) => {
    p.classList.remove("active");
  });
  
  const activePanel = document.getElementById(`${tabId}-panel`);
  if (activePanel) activePanel.classList.add("active");
  
  // Trigger redraws if necessary
  if (tabId === "matches") renderMatchesList();
  if (tabId === "leaderboard") renderLeaderboard();
  if (tabId === "admin" && currentCourt === "admin") renderAdminPortal();
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
  document.getElementById("referee-round-title").textContent = `ROUND ${currentMatch.round} OF 20`;
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
  document.getElementById("score-val-a").textContent = currentMatch.teamAScore;
  document.getElementById("score-val-b").textContent = currentMatch.teamBScore;
  
  // Serving status
  const totalPoints = currentMatch.teamAScore + currentMatch.teamBScore;
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
    
    // Highlight if target score reached
    if (currentMatch.teamAScore >= 15 || currentMatch.teamBScore >= 15) {
      finalizeTrigger.className = "btn btn-gold";
      finalizeTrigger.innerHTML = `<i data-lucide="trophy"></i> Ready to Finalize Match!`;
    } else {
      finalizeTrigger.className = "btn btn-primary";
      finalizeTrigger.innerHTML = `<i data-lucide="check-circle-2"></i> Finalize Match Results`;
    }
    finalizeTrigger.removeAttribute("disabled");
  }
  
  // Undo button status
  const undoBtn = document.getElementById("btn-score-undo");
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
    nextEl.textContent = "This is the final round of the day!";
  }
  
  initLucide();
}

// 6. SCORING MECHANICS & ACTIONS (METHOD A)
function incrementScore(team) {
  if (!currentMatch || currentMatch.status === "finalized") return;
  
  // Offline Guard on critical submission
  if (!isOnline && !firebaseEnabled) {
    alert("Device is offline. Safe storage pending reconnect.");
  }
  
  // Core limits: First to 15, rally scoring
  if (currentMatch.teamAScore >= 15 || currentMatch.teamBScore >= 15) {
    // Already hit target, prevent further additions unless Admin or Manual Override
    if (confirm("Target score of 15 already achieved. Finalize this result or enter a manual score instead?")) {
      triggerFinalizeModal();
    }
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
    teamBScore: currentMatch.teamBScore
  });
  
  let newScoreA = currentMatch.teamAScore;
  let newScoreB = currentMatch.teamBScore;
  
  if (team === "A") {
    newScoreA += 1;
  } else {
    newScoreB += 1;
  }
  
  // Update state locally first for instant visual feedback
  const oldA = currentMatch.teamAScore;
  const oldB = currentMatch.teamBScore;
  
  currentMatch.teamAScore = newScoreA;
  currentMatch.teamBScore = newScoreB;
  currentMatch.scoreHistory = currentHistory;
  if (currentMatch.status === "scheduled") {
    currentMatch.status = "active";
    currentMatch.startedAt = Date.now();
  }
  
  renderActiveScoreboard();
  
  // Speak vocal call
  speakCurrentScore(newScoreA, newScoreB, team);
  
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
  
  // Offline Lock Check
  if (!isOnline && firebaseEnabled) {
    alert("Match finalization is disabled while offline. Please restore connection first.");
    return;
  }
  
  const scoreA = currentMatch.teamAScore;
  const scoreB = currentMatch.teamBScore;
  
  // Require some score
  if (scoreA === 0 && scoreB === 0) {
    alert("Cannot finalize a match with a 0-0 score. Add points first!");
    return;
  }
  
  // If tied, prohibit directly
  if (scoreA === scoreB) {
    alert("Ties are prohibited. Play one deciding rally before finalization!");
    return;
  }
  
  // Normal score limit check, warn if both under 15 and timer not up
  if (scoreA < 15 && scoreB < 15 && timerRemainingSeconds > 0) {
    if (!confirm("Match has not reached 15 points, and the timer is still active. Finalize as a time-limit match anyway?")) {
      return;
    }
    currentMatch.finishReason = "time-limit";
  } else if (scoreA === 15 || scoreB === 15) {
    currentMatch.finishReason = "target-score";
  } else {
    currentMatch.finishReason = "time-limit";
  }
  
  // Render Modal
  document.getElementById("finalize-modal-teams").textContent = `${currentMatch.teamA.join(" / ")} vs ${currentMatch.teamB.join(" / ")}`;
  document.getElementById("finalize-modal-score").textContent = `${scoreA} – ${scoreB}`;
  document.getElementById("finalize-modal-reason").textContent = currentMatch.finishReason === "target-score" ? "Target Score of 15 Achieved" : "Time-Limit Termination";
  
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
      alert("Official result finalized successfully and locked!");
      
      // Progression: Automatically move to next match
      updateActiveMatchState();
    } else {
      alert("Failed to save finalization. Please check connection.");
    }
  });
}

// 9. TIMER ENGINE (8 Minutes)
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
  timerRemainingSeconds = 8 * 60;
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
    
    const card = document.createElement("div");
    card.className = `match-item-card ${isActive ? "active-match" : ""} ${m.status === "finalized" ? "locked" : ""}`;
    card.onclick = () => {
      // Referees can only switch unfinished matches, or view completed. 
      // Admin can select ANY match
      if (currentCourt === "admin" || m.status !== "finalized") {
        currentMatch = m;
        switchTab("score");
        renderActiveScoreboard();
      } else {
        alert("This match has been finalized and locked. Ask an administrator to reopen if correction is needed.");
      }
    };
    
    card.innerHTML = `
      <div class="match-card-top">
        <span>COURT ${m.court} • ROUND ${m.round}</span>
        <span class="match-card-status status-${m.status}">${m.status}</span>
      </div>
      
      <div class="match-card-teams">
        <div class="match-card-team-box">
          <span class="player-small">${m.teamA[0]}</span>
          <span class="player-small-sub">${m.teamA[1]}</span>
        </div>
        
        <div class="match-card-score-box ${isWinnerA ? "winner-a" : isWinnerB ? "winner-b" : ""}">
          <span>${m.teamAScore}</span>
          <span style="font-size:12px; color:var(--text-muted);">:</span>
          <span>${m.teamBScore}</span>
        </div>
        
        <div class="match-card-team-box right">
          <span class="player-small">${m.teamB[0]}</span>
          <span class="player-small-sub">${m.teamB[1]}</span>
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
  
  document.getElementById("admin-stat-completed").textContent = completedCount;
  document.getElementById("admin-stat-active").textContent = activeCourts;
  
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
        <div style="font-weight:600;">${m.teamA.join("/")}</div>
        <div style="font-size:14px; color:var(--primary-green); font-family:var(--font-mono);">${m.teamAScore}</div>
      </td>
      <td>
        <div style="font-weight:600;">${m.teamB.join("/")}</div>
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
  alert("Tournament Builder requires the shared Postgres server connection.");
}
function showBuilderStep() {}
function saveTournamentConfiguration() {}
function saveTournamentPlayers() {}
function generateBuilderFixtures() {}
function publishBuilderTournament() {}
function openPlayersPage() {}
function savePlayerDirectory() {}
function editTournamentDraft() {}
function archiveTournamentById() {}
function selectTournamentType() {}
function showFormatInformation() {}
function confirmTournamentFormat() {}

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
