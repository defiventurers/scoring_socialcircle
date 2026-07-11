// Shared Postgres synchronization bootstrap.
// This file intentionally loads before app.js and installs its overrides on
// DOMContentLoaded, after app.js has defined the original UI functions.

window.addEventListener("DOMContentLoaded", () => {
  const SESSION_TOKEN_KEY = "socialcircle_server_session";
  const SYNC_INTERVAL_MS = 1000;

  let sessionToken = localStorage.getItem(SESSION_TOKEN_KEY) || "";
  let syncTimer = null;
  let syncInFlight = false;
  let writeInFlight = false;

  const originalLoginSuccess = loginSuccess;
  const originalRenderActiveScoreboard = renderActiveScoreboard;

  function setConnectionLabel(text, mode = "offline") {
    const dot = document.getElementById("connection-dot");
    const statusText = document.getElementById("connection-text");
    if (dot) dot.className = `status-dot ${mode}`;
    if (statusText) statusText.textContent = text;
  }

  function setDatabaseBadge(text, isError = false) {
    const badge = document.getElementById("firebase-mode-badge");
    if (!badge) return;
    badge.textContent = text;
    badge.style.color = isError ? "var(--danger)" : "var(--gold-accent)";
  }

  function authHeaders() {
    return sessionToken
      ? { Authorization: `Bearer ${sessionToken}` }
      : {};
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(),
        ...(options.headers || {}),
      },
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function normalizeCourt(value) {
    if (value === "admin") return "admin";
    const parsed = Number(value);
    return [1, 2, 3, 4].includes(parsed) ? parsed : null;
  }

  function clearServerSession(showLogin = true) {
    sessionToken = "";
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem("saved_court");
    localStorage.removeItem("saved_uid");
    stopMatchSync();

    currentCourt = null;
    currentMatch = null;

    if (showLogin) {
      const dashboard = document.getElementById("dashboard-screen");
      const login = document.getElementById("login-screen");
      const pinStep = document.getElementById("login-step-pin");
      const courtStep = document.getElementById("login-step-court");
      if (dashboard) dashboard.classList.add("hidden");
      if (login) login.classList.remove("hidden");
      if (pinStep) pinStep.classList.add("hidden");
      if (courtStep) courtStep.classList.remove("hidden");
      pauseTimer();
    }
  }

  function applyServerMatches(matches) {
    const selectedMatchId = currentMatch?.id || null;
    const nextCache = {};

    for (const match of matches || []) {
      nextCache[match.id] = match;
    }

    matchesCache = nextCache;
    if (selectedMatchId && nextCache[selectedMatchId]) {
      currentMatch = nextCache[selectedMatchId];
    }

    onMatchesDataChanged(nextCache);
  }

  function applySingleMatch(match) {
    if (!match?.id) return;
    matchesCache = { ...matchesCache, [match.id]: match };
    if (currentMatch?.id === match.id) currentMatch = match;
    onMatchesDataChanged(matchesCache);
  }

  function applyWriteAvailability() {
    const blocked = !isOnline || writeInFlight;
    const scoreButtons = [
      document.getElementById("btn-add-a"),
      document.getElementById("btn-add-b"),
    ];
    const undoButton = document.getElementById("btn-score-undo");
    const finalizeButton = document.getElementById("btn-match-finalize-trigger");
    const manualButton = document.querySelector('button[onclick="openQuickScoreSheet()"]');

    for (const button of scoreButtons) {
      if (!button) continue;
      if (blocked || currentMatch?.status === "finalized") {
        button.setAttribute("disabled", "true");
        button.style.opacity = "0.5";
      }
    }

    if (blocked) {
      undoButton?.setAttribute("disabled", "true");
      finalizeButton?.setAttribute("disabled", "true");
      manualButton?.setAttribute("disabled", "true");
    } else {
      manualButton?.removeAttribute("disabled");
    }
  }

  renderActiveScoreboard = function renderActiveScoreboardFromServer() {
    originalRenderActiveScoreboard();
    applyWriteAvailability();
  };

  async function checkHealth() {
    setConnectionLabel("CONNECTING", "saving");
    setDatabaseBadge("Shared Postgres");

    try {
      const health = await requestJson("/api/health");
      isOnline = true;
      setOnlineStatus(true);
      setDatabaseBadge(`Shared Postgres • ${health.matches || 0} matches`);
    } catch (error) {
      isOnline = false;
      setOnlineStatus(false);
      setDatabaseBadge(
        error.payload?.missing?.length
          ? `Configuration Error: ${error.payload.missing.join(", ")}`
          : "Shared Postgres Unavailable",
        true,
      );
    }

    applyWriteAvailability();
  }

  async function syncMatchesFromServer({ initial = false } = {}) {
    if (!sessionToken || syncInFlight || writeInFlight) return false;

    syncInFlight = true;
    if (initial) setConnectionLabel("CONNECTING", "saving");

    try {
      const payload = await requestJson("/api/matches");
      applyServerMatches(payload.matches);
      isOnline = true;
      setOnlineStatus(true);
      setDatabaseBadge("Shared Postgres • Live Sync");
      return true;
    } catch (error) {
      if (error.status === 401) {
        clearServerSession(true);
        const loginError = document.getElementById("login-error");
        if (loginError) {
          loginError.textContent = "Your session expired. Enter the court PIN again.";
          loginError.classList.remove("hidden");
        }
      } else {
        isOnline = false;
        setOnlineStatus(false);
        setDatabaseBadge("Shared Postgres Offline", true);
      }
      return false;
    } finally {
      syncInFlight = false;
      applyWriteAvailability();
    }
  }

  function startMatchSync() {
    stopMatchSync();
    syncTimer = setInterval(() => {
      syncMatchesFromServer();
    }, SYNC_INTERVAL_MS);
  }

  function stopMatchSync() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
  }

  async function runMatchAction(action, extra = {}) {
    if (!currentMatch && action !== "resetAll") {
      throw new Error("No match is selected.");
    }
    if (!sessionToken) {
      throw new Error("Your session has expired. Sign in again.");
    }
    if (!isOnline) {
      throw new Error("OFFLINE — scoring is disabled to prevent conflicting results.");
    }
    if (writeInFlight) {
      throw new Error("A score update is already being saved.");
    }

    writeInFlight = true;
    setSavingState(true);
    applyWriteAvailability();

    try {
      const payload = await requestJson("/api/match-action", {
        method: "POST",
        body: JSON.stringify({
          action,
          ...(action === "resetAll"
            ? {}
            : {
                matchId: currentMatch.id,
                expectedVersion: currentMatch.version,
              }),
          ...extra,
        }),
      });

      if (payload.match) applySingleMatch(payload.match);
      if (payload.matches) applyServerMatches(payload.matches);

      isOnline = true;
      setSavingState(false);
      return payload;
    } catch (error) {
      if (error.status === 409 && error.payload?.match) {
        applySingleMatch(error.payload.match);
        setConnectionLabel("CONFLICT — REFRESHED", "saving");
        setTimeout(() => {
          if (isOnline) setOnlineStatus(true);
        }, 1200);
      } else if (error.status === 401) {
        clearServerSession(true);
      } else if (!navigator.onLine || error.status === 503) {
        isOnline = false;
        setOnlineStatus(false);
      }

      setSavingState(false, true);
      throw error;
    } finally {
      writeInFlight = false;
      applyWriteAvailability();
    }
  }

  initFirebase = function initSharedPostgres() {
    // Keep firebaseEnabled true only to prevent app.js from activating its
    // LocalStorage fallback. No Firebase service is used.
    firebaseEnabled = true;
    db = null;
    localStorage.removeItem("pickleball_social_matches");
    localStorage.removeItem("pickleball_social_court_users");
    setConnectionLabel("CONNECTING", "saving");
    setDatabaseBadge("Shared Postgres");
    checkHealth();
  };

  setupLocalDatabase = function disabledLocalDatabase() {};
  bindLocalListeners = function disabledLocalListeners() {};
  bindFirebaseListeners = function disabledFirebaseListeners() {};
  setupFirebaseConnectionListener = function disabledFirebaseConnection() {};

  submitPinLogin = async function submitServerPinLogin() {
    const pinInput = document.getElementById("court-pin-input");
    const errorEl = document.getElementById("login-error");
    const pin = pinInput?.value || "";

    if (!currentCourt || pin.length < 4 || writeInFlight) {
      if (errorEl && pin.length < 4) {
        errorEl.textContent = "Please enter the complete court PIN.";
        errorEl.classList.remove("hidden");
      }
      return;
    }

    writeInFlight = true;
    setConnectionLabel("AUTHENTICATING", "saving");
    errorEl?.classList.add("hidden");

    try {
      const payload = await requestJson("/api/login", {
        method: "POST",
        body: JSON.stringify({ court: currentCourt, pin }),
      });

      sessionToken = payload.token;
      localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
      localStorage.setItem("saved_court", String(payload.court));
      localStorage.setItem("saved_uid", "postgres-session");

      const loaded = await syncMatchesFromServer({ initial: true });
      if (!loaded) throw new Error("Could not load the shared match schedule.");

      originalLoginSuccess(payload.court, "postgres-session");
      startMatchSync();
      if (pinInput) pinInput.value = "";
    } catch (error) {
      sessionToken = "";
      localStorage.removeItem(SESSION_TOKEN_KEY);
      if (errorEl) {
        errorEl.textContent = error.message || "Login failed.";
        errorEl.classList.remove("hidden");
      }
      setOnlineStatus(Boolean(navigator.onLine));
    } finally {
      writeInFlight = false;
      applyWriteAvailability();
    }
  };

  checkAutologin = async function checkServerAutologin() {
    const savedCourt = normalizeCourt(localStorage.getItem("saved_court"));
    if (!savedCourt || !sessionToken) {
      clearServerSession(false);
      return;
    }

    currentCourt = savedCourt;
    const loaded = await syncMatchesFromServer({ initial: true });
    if (!loaded || !sessionToken) return;

    originalLoginSuccess(savedCourt, "postgres-session");
    startMatchSync();
  };

  logoutSession = function logoutServerSession() {
    clearServerSession(true);
    checkHealth();
  };

  incrementScore = async function incrementSharedScore(team) {
    if (!currentMatch || currentMatch.status === "finalized") return;
    if (currentMatch.teamAScore >= 15 || currentMatch.teamBScore >= 15) {
      triggerFinalizeModal();
      return;
    }

    if (navigator.vibrate) navigator.vibrate(30);

    try {
      const payload = await runMatchAction("score", { team });
      if (payload.match) {
        speakCurrentScore(
          payload.match.teamAScore,
          payload.match.teamBScore,
          team,
        );
      }
    } catch (error) {
      alert(error.message);
    }
  };

  performUndo = async function undoSharedScore() {
    if (!currentMatch || currentMatch.status === "finalized") return;
    try {
      await runMatchAction("undo");
    } catch (error) {
      alert(error.message);
    }
  };

  saveQuickScores = async function saveSharedManualScore() {
    const scoreA = Number(document.getElementById("quick-score-a")?.value);
    const scoreB = Number(document.getElementById("quick-score-b")?.value);
    const isTimeLimit = Boolean(document.getElementById("quick-score-time-limit")?.checked);
    const errorEl = document.getElementById("quick-score-validation-error");

    function showValidation(message) {
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.style.color = "var(--danger)";
      errorEl.classList.remove("hidden");
    }

    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA > 15 || scoreB > 15) {
      showValidation("Scores must be whole numbers from 0 to 15.");
      return;
    }
    if (scoreA === scoreB) {
      showValidation("Tied scores are not allowed. Play one deciding rally.");
      return;
    }
    if (!isTimeLimit && scoreA !== 15 && scoreB !== 15) {
      showValidation("For a standard match, one team must score exactly 15.");
      return;
    }

    try {
      await runMatchAction("manualScore", { scoreA, scoreB, isTimeLimit });
      closeQuickScoreSheet();
    } catch (error) {
      showValidation(error.message);
    }
  };

  submitFinalization = async function finalizeSharedMatch() {
    if (!currentMatch || currentMatch.status === "finalized") return;
    try {
      pauseTimer();
      await runMatchAction("finalize");
      closeFinalizeModal();
      alert("Official result finalized and synchronized across all devices.");
    } catch (error) {
      alert(error.message);
    }
  };

  adminReopenMatch = async function reopenSharedMatch(matchId) {
    const match = matchesCache[matchId];
    if (!match) return;
    if (!confirm(`Reopen Court ${match.court} Round ${match.round}?`)) return;

    currentMatch = match;
    try {
      await runMatchAction("reopen");
      alert("Match reopened on every connected device.");
    } catch (error) {
      alert(error.message);
    }
  };

  adminResetMatch = async function resetSharedMatch(matchId) {
    const match = matchesCache[matchId];
    if (!match) return;
    if (!confirm(`Reset Court ${match.court} Round ${match.round} to 0–0?`)) return;

    currentMatch = match;
    try {
      await runMatchAction("reset");
      alert("Match reset on every connected device.");
    } catch (error) {
      alert(error.message);
    }
  };

  triggerTournamentReset = async function resetSharedTournament() {
    if (!confirm("Reset all 80 matches to 0–0? This cannot be undone.")) return;
    try {
      await runMatchAction("resetAll");
      alert("All shared tournament scores were reset.");
    } catch (error) {
      alert(error.message);
    }
  };

  saveMatchToDatabase = function blockLegacyStorage(_match, callback) {
    console.warn("Legacy LocalStorage/Firebase save was blocked. Use the shared API action endpoints.");
    if (callback) callback(false);
  };

  window.addEventListener("online", () => {
    checkHealth();
    syncMatchesFromServer();
  });

  window.addEventListener("offline", () => {
    isOnline = false;
    setOnlineStatus(false);
    applyWriteAvailability();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncMatchesFromServer();
  });
});
