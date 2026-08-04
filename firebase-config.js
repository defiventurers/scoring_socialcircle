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
  let builderTournament = null;
  let builderPlayers = [];
  let builderMatches = [];
  let builderTournamentType = "mixed-doubles";
  let formatDefinitions = {};

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

  function renderCurrentEventStatus() {
    const status = document.getElementById("admin-event-status");
    const endButton = document.getElementById("btn-end-event");
    if (status) {
      status.textContent = activeTournament
        ? `Current event: ${activeTournament.name} • ${activeTournament.status}`
        : "No active event. You can now create and publish the next event.";
    }
    if (endButton) endButton.disabled = !activeTournament || activeTournament.status !== "published" || writeInFlight;
    if (activeTournament) {
      const duration = Number(activeTournament.settings?.roundDurationMinutes || 8);
      const points = Number(activeTournament.pointsToWin || 15);
      const winBy = Number(activeTournament.winBy || 1);
      const setText = (id, value) => { const element = document.getElementById(id); if (element) element.innerHTML = value; };
      setText("rules-target-score", `<strong>Target:</strong> First team to at least <strong>${points} points</strong>.`);
      setText("rules-win-by", `<strong>Winning margin:</strong> Win by <strong>${winBy}</strong>.`);
      setText("rules-duration", `Matches use a <strong>${duration}-minute</strong> countdown:`);
      setText("rules-timer-mode", activeTournament.settings?.automaticRoundTimer ? "The timer starts automatically with the first point." : "The referee starts the timer when play begins.");
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function loadActiveTournament() {
    const payload = await requestJson("/api/tournaments");
    const tournaments = payload.tournaments || [];
    formatDefinitions = payload.formatDefinitions || formatDefinitions;
    activeTournament = tournaments.find((tournament) => tournament.status === "published") || null;
    const list = document.getElementById("admin-tournament-list");
    if (list && currentCourt === "admin") {
      list.innerHTML = tournaments.map((tournament) => `
        <div class="fixture-preview-row">
          <span><strong>${escapeHtml(tournament.name)}</strong><br><small>${escapeHtml(tournament.status)} · ${tournament.matchCount || 0} matches</small></span>
          <span class="admin-table-actions">
            ${tournament.status === "draft" ? `<button class="btn-table-action" onclick="editTournamentDraft('${tournament.id}')">Edit</button>` : ""}
            ${tournament.status === "published" ? `<button class="btn-table-action danger" onclick="archiveTournamentById('${tournament.id}')">Archive</button>` : ""}
          </span>
        </div>
      `).join("");
    }
    renderCurrentEventStatus();
    return activeTournament;
  }

  function applyWriteAvailability() {
    const eventReadOnly = !activeTournament || activeTournament.status !== "published";
    const blocked = !isOnline || writeInFlight || eventReadOnly;
    const isFinalized = currentMatch?.status === "finalized";
    const scoreButtons = [
      document.getElementById("btn-add-a"),
      document.getElementById("btn-add-b"),
    ];
    const undoButton = document.getElementById("btn-score-undo");
    const finalizeButton = document.getElementById("btn-match-finalize-trigger");
    const manualButton = document.getElementById("btn-manual-score");

    for (const button of scoreButtons) {
      if (!button) continue;
      if (blocked || isFinalized) {
        button.setAttribute("disabled", "true");
        button.style.opacity = "0.5";
      } else {
        button.removeAttribute("disabled");
        button.style.opacity = "1";
      }
    }

    if (blocked || isFinalized) {
      undoButton?.setAttribute("disabled", "true");
      finalizeButton?.setAttribute("disabled", "true");
      manualButton?.setAttribute("disabled", "true");
    } else {
      if (currentMatch?.scoreHistory?.length > 0) {
        undoButton?.removeAttribute("disabled");
      } else {
        undoButton?.setAttribute("disabled", "true");
      }
      finalizeButton?.removeAttribute("disabled");
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
      setDatabaseBadge("Shared Postgres");
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
    if (!sessionToken || syncInFlight || (writeInFlight && !initial)) return false;

    syncInFlight = true;
    if (initial) setConnectionLabel("CONNECTING", "saving");

    try {
      await loadActiveTournament();
      if (!activeTournament) {
        serverLeaderboard = [];
        applyServerMatches([]);
        isOnline = true;
        setOnlineStatus(true);
        setDatabaseBadge("Shared Postgres • 0 matches");
        return true;
      }

      const payload = await requestJson(`/api/matches?tournamentId=${encodeURIComponent(activeTournament.id)}`);
      activeTournament = payload.tournament || activeTournament;
      serverLeaderboard = Array.isArray(payload.leaderboard) ? payload.leaderboard : [];
      applyServerMatches(payload.matches);
      isOnline = true;
      setOnlineStatus(true);
      setDatabaseBadge(`Shared Postgres • ${builderTournament ? builderMatches.length : (payload.matches || []).length} matches`);
      renderCurrentEventStatus();
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
        isOnline = Boolean(navigator.onLine);
        setOnlineStatus(isOnline);
        setDatabaseBadge(error.message || "Shared Postgres Unavailable", true);
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

    let conflict = false;
    try {
      const payload = await requestJson("/api/match-action", {
        method: "POST",
        body: JSON.stringify({
          action,
          tournamentId: activeTournament?.id,
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
      await syncMatchesFromServer({ initial: true });

      isOnline = true;
      setSavingState(false);
      return payload;
    } catch (error) {
      if (error.status === 409 && error.payload?.match) {
        conflict = true;
        applySingleMatch(error.payload.match);
        setConnectionLabel("CONFLICT — REFRESHED", "saving");
        setTimeout(() => {
          if (isOnline) setOnlineStatus(true);
        }, 1200);
      } else if (error.status === 401) {
        clearServerSession(true);
      } else if (!navigator.onLine) {
        isOnline = false;
        setOnlineStatus(false);
      } else {
        isOnline = true;
        setOnlineStatus(true);
        setDatabaseBadge(error.message || "Server request failed", true);
      }

      if (!conflict) setSavingState(false, true);
      throw error;
    } finally {
      writeInFlight = false;
      if (currentMatch) renderActiveScoreboard();
      else applyWriteAvailability();
    }
  }

  async function authenticateAndEnter(court, pin, errorEl, pinInput) {
    const payload = await requestJson("/api/login", {
      method: "POST",
      body: JSON.stringify({ court, pin }),
    });

    sessionToken = payload.token;
    localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
    localStorage.setItem("saved_court", String(payload.court));
    localStorage.setItem("saved_uid", "postgres-session");

    const loaded = await syncMatchesFromServer({ initial: true });
    if (!loaded) throw new Error("Could not load the shared match schedule.");

    originalLoginSuccess(payload.court, "postgres-session");
    if (payload.role === "admin") {
      setTimeout(() => openTournamentBuilder(), 0);
    }
    startMatchSync();
    if (pinInput) pinInput.value = "";
    errorEl?.classList.add("hidden");
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
      await authenticateAndEnter(currentCourt, pin, errorEl, pinInput);
    } catch (error) {
      sessionToken = "";
      localStorage.removeItem(SESSION_TOKEN_KEY);
      localStorage.removeItem("saved_uid");
      if (errorEl) {
        errorEl.textContent = error.message || "Login failed.";
        errorEl.classList.remove("hidden");
      }
      if (navigator.onLine) {
        isOnline = true;
        setOnlineStatus(true);
      } else {
        isOnline = false;
        setOnlineStatus(false);
      }
    } finally {
      writeInFlight = false;
      if (currentMatch) renderActiveScoreboard();
      else applyWriteAvailability();
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

  validateAdminPasscode = async function validateServerAdminPasscode() {
    const pinInput = document.getElementById("admin-passcode-input");
    const errorEl = document.getElementById("admin-passcode-error");
    const pin = pinInput?.value || "";
    if (pin.length < 4 || writeInFlight) return;

    currentCourt = "admin";
    writeInFlight = true;
    errorEl?.classList.add("hidden");

    try {
      await authenticateAndEnter("admin", pin, errorEl, pinInput);
      closeAdminGate();
    } catch (error) {
      sessionToken = "";
      localStorage.removeItem(SESSION_TOKEN_KEY);
      if (errorEl) {
        errorEl.textContent = error.message || "Admin login failed.";
        errorEl.classList.remove("hidden");
      }
    } finally {
      writeInFlight = false;
      if (currentMatch) renderActiveScoreboard();
    }
  };

  incrementScore = async function incrementSharedScore(team) {
    if (!currentMatch || currentMatch.status === "finalized") return;
    const targetScore = Number(activeTournament?.pointsToWin || 15);
    const maxScore = targetScore + Math.max(1, Number(activeTournament?.winBy || 1)) - 1;
    if (currentMatch.teamAScore >= maxScore || currentMatch.teamBScore >= maxScore) {
      triggerFinalizeModal();
      return;
    }

    if (navigator.vibrate) navigator.vibrate(30);

    try {
      const payload = await runMatchAction("score", { team });
      if (payload.match) {
        if (activeTournament?.settings?.automaticRoundTimer === true && !timerRunning && payload.match.status === "active") startTimer();
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

  openQuickScoreSheet = function openConfiguredQuickScoreSheet() {
    if (!currentMatch || currentMatch.status === "finalized" || activeTournament?.settings?.allowManualScoreOverrides === false) return;
    const targetScore = Number(activeTournament?.pointsToWin || 15);
    const winBy = Number(activeTournament?.winBy || 1);
    const maxScore = targetScore + winBy - 1;
    const scoreA = document.getElementById("quick-score-a");
    const scoreB = document.getElementById("quick-score-b");
    scoreA.max = String(maxScore); scoreB.max = String(maxScore);
    scoreA.value = currentMatch.teamAScore; scoreB.value = currentMatch.teamBScore;
    const timeLimit = document.getElementById("quick-score-time-limit");
    timeLimit.checked = timerRemainingSeconds <= 0;
    timeLimit.disabled = activeTournament?.settings?.allowTimeLimitResults === false;
    document.querySelector("#quick-score-overlay p").textContent = `Enter the final score. Standard results require ${targetScore} points and a ${winBy}-point winning margin.`;
    document.getElementById("quick-score-validation-error").classList.add("hidden");
    document.getElementById("quick-score-overlay").classList.add("active");
    toggleQuickScoreRuleTip();
  };

  saveQuickScores = async function saveSharedManualScore() {
    if (activeTournament?.settings?.allowManualScoreOverrides === false) {
      alert("Manual score overrides are disabled for this tournament.");
      return;
    }
    const scoreA = Number(document.getElementById("quick-score-a")?.value);
    const scoreB = Number(document.getElementById("quick-score-b")?.value);
    const isTimeLimit = Boolean(document.getElementById("quick-score-time-limit")?.checked);
    const targetScore = Number(activeTournament?.pointsToWin || 15);
    const winBy = Number(activeTournament?.winBy || 1);
    const maxScore = targetScore + winBy - 1;
    const errorEl = document.getElementById("quick-score-validation-error");

    function showValidation(message) {
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.style.color = "var(--danger)";
      errorEl.classList.remove("hidden");
    }

    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA > maxScore || scoreB > maxScore) {
      showValidation(`Scores must be whole numbers from 0 to ${maxScore}.`);
      return;
    }
    if (scoreA === scoreB) {
      showValidation("Tied scores are not allowed. Play one deciding rally.");
      return;
    }
    if (isTimeLimit && activeTournament?.settings?.allowTimeLimitResults === false) {
      showValidation("Time-limit results are disabled for this tournament.");
      return;
    }
    if (!isTimeLimit && (Math.max(scoreA, scoreB) < targetScore || Math.abs(scoreA - scoreB) < winBy)) {
      showValidation(`A standard result requires ${targetScore} points and a ${winBy}-point winning margin.`);
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
    const totalMatches = Object.keys(matchesCache).length;
    if (!confirm(`Reset all ${totalMatches} matches to 0–0? This cannot be undone.`)) return;
    try {
      await runMatchAction("resetAll");
      alert("All shared tournament scores were reset.");
    } catch (error) {
      alert(error.message);
    }
  };

  function setBuilderMessage(message = "", mode = "info") {
    const element = document.getElementById("builder-message");
    if (!element) return;
    element.textContent = message;
    element.className = `action-message ${mode}${message ? "" : " hidden"}`;
  }

  function setActionPending(buttonId, pending, pendingLabel) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    if (pending) {
      button.dataset.label = button.textContent;
      button.textContent = pendingLabel;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  function builderValue(id) { return document.getElementById(id)?.value; }
  function builderNumber(id) { return Number(builderValue(id)); }

  function validateBuilderSettings() {
    const name = String(builderValue("builder-name") || "").trim();
    const errors = [];
    const nameError = document.getElementById("builder-name-error");
    if (name.length < 3) errors.push("Enter a tournament name with at least 3 characters.");
    if (!Number.isInteger(builderNumber("builder-player-count")) || builderNumber("builder-player-count") < 4 || builderNumber("builder-player-count") > 40 || builderNumber("builder-player-count") % 2) errors.push("Players must be an even number from 4 to 40.");
    if (!Number.isInteger(builderNumber("builder-court-count")) || builderNumber("builder-court-count") < 1 || builderNumber("builder-court-count") > 12) errors.push("Courts must be from 1 to 12.");
    if (!Number.isInteger(builderNumber("builder-match-duration")) || builderNumber("builder-match-duration") < 1 || builderNumber("builder-match-duration") > 180) errors.push("Match duration must be from 1 to 180 minutes.");
    if (!Number.isInteger(builderNumber("builder-points-to-win")) || builderNumber("builder-points-to-win") < 1 || builderNumber("builder-points-to-win") > 99) errors.push("Points to win must be from 1 to 99.");
    if (!Number.isInteger(builderNumber("builder-win-by")) || builderNumber("builder-win-by") < 1 || builderNumber("builder-win-by") > 10) errors.push("Win by must be from 1 to 10.");
    if (!Number.isInteger(builderNumber("builder-round-count")) || builderNumber("builder-round-count") < 1 || builderNumber("builder-round-count") > 100) errors.push("Rounds must be from 1 to 100.");
    if (!Number.isInteger(builderNumber("builder-round-gap")) || builderNumber("builder-round-gap") < 0 || builderNumber("builder-round-gap") > 120) errors.push("Time between rounds must be from 0 to 120 minutes.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(builderValue("builder-start-time") || ""))) errors.push("Choose a valid tournament start time.");
    if (nameError) { nameError.textContent = name.length < 3 ? "Enter at least 3 characters." : ""; nameError.classList.toggle("hidden", name.length >= 3); }
    const summary = document.getElementById("builder-settings-error");
    if (summary) { summary.textContent = errors[0] || ""; summary.classList.toggle("hidden", !errors.length); }
    return errors.length ? null : name;
  }

  editTournamentDraft = async function editSharedTournamentDraft(tournamentId) {
    try {
      const payload = await requestJson(`/api/tournaments?tournamentId=${encodeURIComponent(tournamentId)}`);
      builderTournament = payload.tournament;
      builderPlayers = payload.players || [];
      builderMatches = payload.matches || [];
      builderTournamentType = builderTournament.tournamentType || "mixed-doubles";
      formatDefinitions = payload.formatDefinitions || formatDefinitions;
      document.getElementById("builder-title").textContent = "Edit Draft Event";
      document.getElementById("builder-name").value = builderTournament.name;
      document.getElementById("builder-format").value = builderTournament.format;
      document.getElementById("builder-player-count").value = builderTournament.maxPlayers;
      document.getElementById("builder-court-count").value = builderTournament.numberOfCourts;
      document.getElementById("builder-round-count").value = builderTournament.settings?.numberOfRounds || 20;
      document.getElementById("builder-match-duration").value = builderTournament.settings?.roundDurationMinutes || 8;
      document.getElementById("builder-points-to-win").value = builderTournament.pointsToWin || 15;
      document.getElementById("builder-win-by").value = builderTournament.winBy || 1;
      document.getElementById("builder-round-gap").value = builderTournament.settings?.intervalMinutes ?? 2;
      document.getElementById("builder-start-time").value = builderTournament.settings?.startTime || `${String(builderTournament.settings?.startHour || 11).padStart(2, "0")}:00`;
      document.getElementById("builder-auto-timer").checked = builderTournament.settings?.automaticRoundTimer !== false;
      document.getElementById("builder-manual-overrides").checked = builderTournament.settings?.allowManualScoreOverrides !== false;
      document.getElementById("builder-time-limit-results").checked = builderTournament.settings?.allowTimeLimitResults !== false;
      document.getElementById("builder-location").value = builderTournament.location || "";
      document.getElementById("builder-date").value = builderTournament.date ? String(builderTournament.date).slice(0, 10) : "";
      showBuilderStep(builderPlayers.length ? "players" : "details");
      if (builderPlayers.length) renderPlayerInputs("builder-player-grid", builderPlayers);
      switchTab("builder");
    } catch (error) { alert(error.message); }
  };

  archiveTournamentById = async function archiveSharedTournamentById(tournamentId) {
    if (!confirm("Archive this published event? Scores and reports will remain available.")) return;
    try {
      await requestJson("/api/tournaments", { method: "PATCH", body: JSON.stringify({ action: "archive", tournamentId }) });
      activeTournament = null;
      currentMatch = null;
      applyServerMatches([]);
      await loadActiveTournament();
      setDatabaseBadge("Shared Postgres • 0 matches");
    } catch (error) { alert(error.message); }
  };

  openTournamentBuilder = async function openSharedTournamentBuilder() {
    if (currentCourt !== "admin") return;
    builderTournament = null;
    builderPlayers = [];
    builderMatches = [];
    builderTournamentType = "mixed-doubles";
    setBuilderMessage();
    document.getElementById("builder-title").textContent = "Create Tournament";
    document.getElementById("builder-name").value = "";
    document.getElementById("builder-player-count").value = 16;
    document.getElementById("builder-court-count").value = 4;
    document.getElementById("builder-round-count").value = 6;
    document.getElementById("builder-match-duration").value = 8;
    document.getElementById("builder-points-to-win").value = 15;
    document.getElementById("builder-win-by").value = 1;
    document.getElementById("builder-round-gap").value = 2;
    document.getElementById("builder-start-time").value = "11:00";
    document.getElementById("builder-auto-timer").checked = true;
    document.getElementById("builder-manual-overrides").checked = true;
    document.getElementById("builder-time-limit-results").checked = true;
    switchTab("builder");
    try {
      const payload = await requestJson("/api/tournaments");
      formatDefinitions = payload.formatDefinitions || {};
      const select = document.getElementById("builder-format");
      select.innerHTML = Object.values(formatDefinitions).map((format) => `<option value="${format.id}">${escapeHtml(format.name)}</option>`).join("");
      showBuilderStep("type");
    } catch (error) {
      setBuilderMessage(error.message || "Could not load tournament formats.", "error");
    }
  };

  selectTournamentType = function selectBuilderTournamentType(type) {
    builderTournamentType = type;
    showBuilderStep("format");
    showFormatInformation();
  };

  showFormatInformation = function renderFormatInformation() {
    const definition = formatDefinitions[document.getElementById("builder-format")?.value];
    if (!definition) return;
    document.getElementById("format-info-content").innerHTML = `
      <p>${escapeHtml(definition.description)}</p>
      <dl><dt>How it works</dt><dd>${escapeHtml(definition.howItWorks)}</dd><dt>Rotation / teams</dt><dd>${escapeHtml(definition.rotation)}</dd><dt>Winner</dt><dd>${escapeHtml(definition.winner)}</dd><dt>Best use</dt><dd>${escapeHtml(definition.bestUse)}</dd></dl>`;
    document.getElementById("format-info-card").open = true;
  };

  confirmTournamentFormat = function confirmBuilderTournamentFormat() {
    document.getElementById("format-info-card").open = false;
    showBuilderStep("details");
  };

  showBuilderStep = function showSharedBuilderStep(step) {
    const mapping = { type: 0, format: 1, details: 2, players: 3, fixtures: 4, preview: 5 };
    setBuilderMessage();
    document.querySelectorAll(".builder-step").forEach((element) => element.classList.remove("active"));
    document.getElementById(`builder-${step}-step`)?.classList.add("active");
    document.querySelectorAll("#builder-steps span").forEach((element, index) => element.classList.toggle("active", index <= (mapping[step] ?? 0)));
    document.getElementById("builder-panel")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  function permanentLabels(count) {
    if (builderTournamentType === "mens-doubles") return Array.from({ length: Math.min(20, count) }, (_, index) => ({ label: String(index + 1), gender: "men" }));
    if (builderTournamentType === "womens-doubles") return Array.from({ length: Math.min(20, count) }, (_, index) => ({ label: String.fromCharCode(65 + index), gender: "women" }));
    const menCount = Math.min(20, Math.floor(count / 2));
    const womenCount = Math.min(20, count - menCount);
    return [
      ...Array.from({ length: menCount }, (_, index) => ({ label: String(index + 1), gender: "men" })),
      ...Array.from({ length: womenCount }, (_, index) => ({ label: String.fromCharCode(65 + index), gender: "women" })),
    ];
  }

  function renderPlayerInputs(containerId, players) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = players.map((player) => `
      <label class="player-assignment-card">
        <span class="player-label-pill">${player.label}</span>
        <span class="meta-label">${player.gender === "men" ? "Men" : "Women"}</span>
        <input class="form-input player-display-name" data-label="${player.label}" data-gender="${player.gender}" value="${escapeHtml(player.displayName || "")}" placeholder="Display name (optional)" />
      </label>
    `).join("");
  }

  saveTournamentConfiguration = async function saveSharedTournamentConfiguration() {
    const name = validateBuilderSettings();
    if (!name || writeInFlight) return;
    const body = {
      name,
      format: document.getElementById("builder-format").value,
      tournamentType: builderTournamentType,
      maxPlayers: builderNumber("builder-player-count"),
      numberOfCourts: builderNumber("builder-court-count"),
      numberOfRounds: builderNumber("builder-round-count"),
      matchDurationMinutes: builderNumber("builder-match-duration"),
      pointsToWin: builderNumber("builder-points-to-win"),
      winBy: builderNumber("builder-win-by"),
      timeBetweenRoundsMinutes: builderNumber("builder-round-gap"),
      startTime: builderValue("builder-start-time"),
      automaticRoundTimer: Boolean(document.getElementById("builder-auto-timer").checked),
      allowManualScoreOverrides: Boolean(document.getElementById("builder-manual-overrides").checked),
      allowTimeLimitResults: Boolean(document.getElementById("builder-time-limit-results").checked),
      location: builderValue("builder-location"),
      date: builderValue("builder-date") || null,
      status: "draft",
    };
    writeInFlight = true;
    setActionPending("builder-save-settings", true, "Saving…");
    setBuilderMessage("Saving tournament settings…", "loading");
    try {
      const requestBody = builderTournament ? { ...body, action: "update", tournamentId: builderTournament.id } : body;
      const payload = await requestJson("/api/tournaments", { method: builderTournament ? "PATCH" : "POST", body: JSON.stringify(requestBody) });
      builderTournament = payload.tournament;
      const directory = await requestJson("/api/players");
      const byLabel = new Map((directory.players || []).map((player) => [player.label, player]));
      builderPlayers = permanentLabels(builderTournament.maxPlayers).map((player) => ({ ...player, displayName: byLabel.get(player.label)?.displayName || "" }));
      renderPlayerInputs("builder-player-grid", builderPlayers);
      setBuilderMessage("Settings saved.", "success");
      showBuilderStep("players");
    } catch (error) {
      setBuilderMessage(error.message || "Could not save tournament settings.", "error");
    } finally {
      writeInFlight = false;
      setActionPending("builder-save-settings", false);
    }
  };

  saveTournamentPlayers = async function saveSharedTournamentPlayers() {
    if (!builderTournament || writeInFlight) return;
    builderPlayers = Array.from(document.querySelectorAll("#builder-player-grid .player-display-name")).map((input) => ({ label: input.dataset.label, gender: input.dataset.gender, displayName: input.value.trim() }));
    writeInFlight = true;
    setActionPending("builder-save-players", true, "Saving…");
    setBuilderMessage("Saving roster…", "loading");
    try {
      await requestJson("/api/tournaments", { method: "PATCH", body: JSON.stringify({ action: "assignPlayers", tournamentId: builderTournament.id, players: builderPlayers }) });
      document.getElementById("builder-assignment-summary").textContent = `${builderPlayers.length} permanent labels assigned. Names are saved independently from fixture labels.`;
      showBuilderStep("fixtures");
    } catch (error) {
      setBuilderMessage(error.message || "Could not save players.", "error");
    } finally {
      writeInFlight = false;
      setActionPending("builder-save-players", false);
    }
  };

  generateBuilderFixtures = async function generateSharedBuilderFixtures() {
    if (!builderTournament || writeInFlight) return;
    writeInFlight = true;
    setActionPending("builder-generate", true, "Generating…");
    setBuilderMessage("Generating the draft schedule…", "loading");
    try {
      const payload = await requestJson("/api/tournaments", { method: "PATCH", body: JSON.stringify({ action: "generateFixtures", tournamentId: builderTournament.id }) });
      builderTournament = payload.tournament;
      builderMatches = payload.matches || [];
      document.getElementById("builder-preview-summary").textContent = `${builderMatches.length} matches generated across ${builderTournament.numberOfCourts} courts.`;
      document.getElementById("builder-preview-list").innerHTML = builderMatches.slice(0, 24).map((match) => `<div class="fixture-preview-row"><strong>R${match.round} · Court ${match.court}</strong><span>${match.teamA.join(" / ")} vs ${match.teamB.join(" / ")}</span></div>`).join("") + (builderMatches.length > 24 ? `<p class="setup-note">Showing first 24 of ${builderMatches.length} matches.</p>` : "");
      setDatabaseBadge(`Shared Postgres • ${builderMatches.length} matches`);
      showBuilderStep("preview");
    } catch (error) {
      setBuilderMessage(error.message || "Could not generate fixtures.", "error");
    } finally {
      writeInFlight = false;
      setActionPending("builder-generate", false);
    }
  };

  publishBuilderTournament = async function publishSharedBuilderTournament() {
    if (!builderTournament || writeInFlight || !confirm(`Publish “${builderTournament.name}”? It will become the active scoring event.`)) return;
    writeInFlight = true;
    setActionPending("builder-publish", true, "Publishing…");
    setBuilderMessage("Publishing tournament…", "loading");
    try {
      const payload = await requestJson("/api/tournaments", { method: "PATCH", body: JSON.stringify({ action: "publish", tournamentId: builderTournament.id }) });
      activeTournament = payload.tournament;
      builderTournament = null;
      writeInFlight = false;
      await syncMatchesFromServer({ initial: true });
      switchTab("admin");
      setDatabaseBadge(`Published • ${builderMatches.length} matches`);
    } catch (error) {
      setBuilderMessage(error.message || "Could not publish the tournament.", "error");
    } finally {
      writeInFlight = false;
      setActionPending("builder-publish", false);
    }
  };

  openPlayersPage = async function openSharedPlayersPage() {
    if (currentCourt !== "admin") return;
    try {
      const payload = await requestJson("/api/players");
      const byLabel = new Map((payload.players || []).map((player) => [player.label, player]));
      const players = permanentLabels(40).map((player) => ({ ...player, displayName: byLabel.get(player.label)?.displayName || "" }));
      renderPlayerInputs("players-directory-grid", players);
      switchTab("players");
    } catch (error) { alert(error.message); }
  };

  savePlayerDirectory = async function saveSharedPlayerDirectory() {
    const inputs = Array.from(document.querySelectorAll("#players-directory-grid .player-display-name"));
    try {
      const players = inputs.map((input) => ({ label: input.dataset.label, displayName: input.value.trim() }));
      await requestJson("/api/players", { method: "POST", body: JSON.stringify({ players }) });
      alert("Player names saved. Permanent labels and existing fixtures were not changed.");
    } catch (error) { alert(error.message); }
  };

  triggerEndEvent = async function endSharedEvent() {
    if (!activeTournament || activeTournament.status !== "published") {
      alert("There is no active event to end.");
      return;
    }
    if (writeInFlight) return;

    const unfinished = Object.values(matchesCache).filter((match) => match.status !== "finalized").length;
    const warning = unfinished > 0
      ? `${unfinished} matches are not finalized. Ending the event will make every match read-only.`
      : "All matches are finalized.";
    if (!confirm(`End “${activeTournament.name}”?\n\n${warning}\n\nScores and reports will be preserved.`)) return;
    if (!confirm("Final confirmation: archive this event and allow the next event to be published?")) return;

    writeInFlight = true;
    setSavingState(true);
    renderCurrentEventStatus();
    try {
      const payload = await requestJson("/api/tournaments", {
        method: "PATCH",
        body: JSON.stringify({ action: "end", tournamentId: activeTournament.id }),
      });
      activeTournament = null;
      currentMatch = null;
      pauseTimer();
      applyServerMatches([]);
      setSavingState(false);
      setDatabaseBadge("Shared Postgres • 0 matches");
      alert(`“${payload.tournament.name}” has ended. Scores remain archived and the next event can now be created.`);
    } catch (error) {
      setSavingState(false, true);
      alert(error.message || "The event could not be ended.");
    } finally {
      writeInFlight = false;
      renderCurrentEventStatus();
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
