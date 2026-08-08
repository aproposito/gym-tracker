import {
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  buildShortcutRunUrl,
  cloneData,
  completeWorkoutSession,
  createId,
  createWorkoutSession,
  discardWorkoutSession,
  emptyReadiness,
  getExerciseProgress,
  getLatestSession,
  getPersonalRecords,
  getSessionTotals,
  getSuggestedRoutineId,
  normalizeName,
  normalizeReadinessPayload,
  normalizeState,
  todayKey,
  updateReadinessCheckin
} from "./domain.js";

const byId = (id) => document.getElementById(id);
const views = [...document.querySelectorAll(".view")];
const navButtons = [...document.querySelectorAll("[data-view-target]")];
const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric"
});
const weekdayFormatter = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long"
});

let state = loadState();
let currentView = state.activeSession ? "session" : "home";
let editorRoutineId = state.settings.selectedRoutineId;
let progressExerciseKey = "";
let waitingServiceWorker = null;
let toastTimeout = null;
let timerCompletionHandled = false;
let reloadingForUpdate = false;

const elements = {
  appHeader: byId("appHeader"),
  pageTitle: byId("pageTitle"),
  todayLabel: byId("todayLabel"),
  settingsButton: byId("settingsButton"),
  bottomNav: byId("bottomNav"),
  readinessPanel: byId("readinessPanel"),
  readinessTitle: byId("readinessTitle"),
  readinessScore: byId("readinessScore"),
  readinessRecommendation: byId("readinessRecommendation"),
  readinessFactors: byId("readinessFactors"),
  readinessButton: byId("readinessButton"),
  energyControl: byId("energyControl"),
  sorenessControl: byId("sorenessControl"),
  routineSuggestionLabel: byId("routineSuggestionLabel"),
  nextWorkoutTitle: byId("nextWorkoutTitle"),
  routineSummary: byId("routineSummary"),
  homeRoutineSelector: byId("homeRoutineSelector"),
  startWorkoutButton: byId("startWorkoutButton"),
  lastWorkout: byId("lastWorkout"),
  homeRecords: byId("homeRecords"),
  sessionRoutineName: byId("sessionRoutineName"),
  sessionStartedLabel: byId("sessionStartedLabel"),
  sessionElapsed: byId("sessionElapsed"),
  sessionProgressText: byId("sessionProgressText"),
  sessionProgressPercent: byId("sessionProgressPercent"),
  sessionProgressBar: byId("sessionProgressBar"),
  sessionExerciseList: byId("sessionExerciseList"),
  finishWorkoutButton: byId("finishWorkoutButton"),
  discardWorkoutButton: byId("discardWorkoutButton"),
  timerDock: byId("timerDock"),
  timerDisplay: byId("timerDisplay"),
  timerToggleButton: byId("timerToggleButton"),
  timerResetButton: byId("timerResetButton"),
  progressExerciseSelect: byId("progressExerciseSelect"),
  progressLatest: byId("progressLatest"),
  progressRecord: byId("progressRecord"),
  progressChart: byId("progressChart"),
  historyCount: byId("historyCount"),
  historyList: byId("historyList"),
  editorRoutineSelector: byId("editorRoutineSelector"),
  editorRoutineName: byId("editorRoutineName"),
  editableExerciseList: byId("editableExerciseList"),
  addRoutineButton: byId("addRoutineButton"),
  renameRoutineButton: byId("renameRoutineButton"),
  deleteRoutineButton: byId("deleteRoutineButton"),
  addExerciseForm: byId("addExerciseForm"),
  exerciseNameInput: byId("exerciseNameInput"),
  exerciseSetsInput: byId("exerciseSetsInput"),
  exerciseTargetInput: byId("exerciseTargetInput"),
  exerciseMeasureInput: byId("exerciseMeasureInput"),
  exerciseWeightLabel: byId("exerciseWeightLabel"),
  exerciseWeightInput: byId("exerciseWeightInput"),
  settingsDialog: byId("settingsDialog"),
  restSecondsInput: byId("restSecondsInput"),
  shortcutNameInput: byId("shortcutNameInput"),
  shareBackupButton: byId("shareBackupButton"),
  downloadBackupButton: byId("downloadBackupButton"),
  importInput: byId("importInput"),
  discardDialog: byId("discardDialog"),
  confirmDiscardButton: byId("confirmDiscardButton"),
  updateToast: byId("updateToast"),
  applyUpdateButton: byId("applyUpdateButton"),
  appToast: byId("appToast")
};

processReadinessReturn();
saveState();
bindEvents();
render();
registerServiceWorker();
setInterval(tickClocks, 500);

function loadState() {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn(`No se pudo leer ${key}`, error);
    }
  }
  return normalizeState(null);
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("No se pudo guardar Gym Tracker", error);
    showToast("No se han podido guardar los cambios.");
  }
}

function bindEvents() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.viewTarget));
  });

  document.querySelectorAll("[data-go-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.goView));
  });

  elements.homeRoutineSelector.addEventListener("click", handleHomeRoutineSelection);
  elements.editorRoutineSelector.addEventListener("click", handleEditorRoutineSelection);
  elements.startWorkoutButton.addEventListener("click", startWorkout);
  elements.finishWorkoutButton.addEventListener("click", finishWorkout);
  elements.discardWorkoutButton.addEventListener("click", () => openDialog(elements.discardDialog));
  elements.confirmDiscardButton.addEventListener("click", confirmDiscardWorkout);
  elements.sessionExerciseList.addEventListener("input", handleSessionInput);
  elements.sessionExerciseList.addEventListener("click", handleSessionClick);
  elements.timerToggleButton.addEventListener("click", toggleRestTimer);
  elements.timerResetButton.addEventListener("click", resetRestTimer);

  elements.readinessButton.addEventListener("click", launchReadinessShortcut);
  document.querySelectorAll("[data-readiness-field]").forEach((button) => {
    button.addEventListener("click", handleReadinessCheckin);
  });

  elements.progressExerciseSelect.addEventListener("change", () => {
    progressExerciseKey = elements.progressExerciseSelect.value;
    renderProgress();
  });

  elements.addRoutineButton.addEventListener("click", addRoutine);
  elements.renameRoutineButton.addEventListener("click", renameRoutine);
  elements.deleteRoutineButton.addEventListener("click", deleteRoutine);
  elements.editableExerciseList.addEventListener("click", handleRoutineEditorClick);
  elements.editableExerciseList.addEventListener("change", handleRoutineEditorChange);
  elements.addExerciseForm.addEventListener("submit", addExercise);
  elements.exerciseMeasureInput.addEventListener("change", updateAddExerciseFields);

  elements.settingsButton.addEventListener("click", openSettings);
  elements.settingsDialog.addEventListener("close", saveSettings);
  elements.restSecondsInput.addEventListener("change", saveSettings);
  elements.shortcutNameInput.addEventListener("change", saveSettings);
  elements.shareBackupButton.addEventListener("click", shareBackup);
  elements.downloadBackupButton.addEventListener("click", downloadBackup);
  elements.importInput.addEventListener("change", importBackup);

  elements.applyUpdateButton.addEventListener("click", applyServiceWorkerUpdate);
  window.addEventListener("resize", () => {
    if (currentView === "history") renderProgress();
  });
  document.addEventListener("visibilitychange", tickClocks);
}

function render() {
  const sessionActive = Boolean(state.activeSession);
  if (sessionActive) currentView = "session";
  if (!sessionActive && currentView === "session") currentView = "home";

  document.body.classList.toggle("session-active", sessionActive);
  elements.appHeader.hidden = sessionActive;
  elements.bottomNav.hidden = sessionActive;
  elements.timerDock.hidden = !sessionActive;

  views.forEach((view) => view.classList.toggle("active", view.dataset.view === currentView));
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.viewTarget === currentView));

  if (sessionActive) {
    renderSession();
    tickClocks();
    return;
  }

  const titles = {
    home: [weekdayFormatter.format(new Date()), "Gym Tracker"],
    history: ["Tu evolución", "Historial"],
    routines: ["Tus plantillas", "Rutinas"]
  };
  const [eyebrow, title] = titles[currentView] || titles.home;
  elements.todayLabel.textContent = eyebrow;
  elements.pageTitle.textContent = title;
  renderHome();
  renderHistory();
  renderRoutines();
}

function showView(viewName) {
  if (state.activeSession) return;
  if (!['home', 'history', 'routines'].includes(viewName)) return;
  currentView = viewName;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderHome() {
  renderReadiness();
  renderHomeRoutine();
  renderLastWorkout();
  renderHomeRecords();
}

function renderReadiness() {
  const readiness = state.readiness || emptyReadiness();
  const isToday = readiness.date === todayKey();
  const valid = isToday && Number.isFinite(readiness.score);
  const band = valid ? readiness.band : "unknown";
  const titles = { green: "Preparado", amber: "Con cautela", red: "Recupera", unknown: "Sin calcular" };

  elements.readinessPanel.classList.remove(
    "readiness-green",
    "readiness-amber",
    "readiness-red",
    "readiness-unknown"
  );
  elements.readinessPanel.classList.add(`readiness-${band}`);
  elements.readinessTitle.textContent = isToday && readiness.updatedAt && !valid
    ? "Datos insuficientes"
    : !isToday && readiness.date
      ? "Sin calcular hoy"
      : titles[band];
  elements.readinessScore.textContent = valid ? String(readiness.score) : "--";
  elements.readinessScore.setAttribute(
    "aria-label",
    valid ? `Readiness ${readiness.score} sobre 100` : "Readiness sin calcular"
  );
  elements.readinessRecommendation.textContent = valid
    ? readiness.recommendation
    : isToday && readiness.updatedAt
      ? "Necesitamos al menos dos señales de Apple Salud."
      : readiness.date
        ? "Última lectura: " + formatDate(readiness.date)
        : "Consulta Apple Salud antes de entrenar.";

  const factors = valid
    ? readiness.factors
    : isToday && readiness.updatedAt
      ? ["Faltan datos suficientes de Apple Salud"]
      : [];
  elements.readinessFactors.innerHTML = factors
    .map((factor) => `<li>${escapeHtml(factor)}</li>`)
    .join("");

  document.querySelectorAll("[data-readiness-field]").forEach((button) => {
    const selected = isToday && readiness[button.dataset.readinessField] === button.dataset.value;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function renderHomeRoutine() {
  const suggestedId = getSuggestedRoutineId(state);
  let selected = state.routines.find((routine) => routine.id === state.settings.selectedRoutineId);
  if (!selected) {
    selected = state.routines.find((routine) => routine.id === suggestedId) || state.routines[0];
    state.settings.selectedRoutineId = selected?.id || "";
    saveState();
  }

  elements.homeRoutineSelector.innerHTML = routineSelectorHtml(
    state.routines,
    selected?.id,
    suggestedId,
    "home-routine"
  );
  elements.nextWorkoutTitle.textContent = selected?.name || "Sin rutinas";
  elements.routineSummary.textContent = `${selected?.exercises.length || 0} ejercicios`;
  elements.routineSuggestionLabel.textContent = selected?.id === suggestedId ? "Siguiente sugerida" : "Rutina elegida";
  elements.startWorkoutButton.disabled = !selected || !selected.exercises.length;
}

function renderLastWorkout() {
  const session = getLatestSession(state.history);
  if (!session) {
    elements.lastWorkout.innerHTML = '<div class="empty-state">Aún no hay sesiones guardadas</div>';
    return;
  }

  const totals = getSessionTotals(session);
  elements.lastWorkout.innerHTML = `
    <div class="last-session-row">
      <div>
        <strong>${escapeHtml(session.routineName)}</strong>
        <p>${escapeHtml(formatDate(session.completedAt))} · ${totals.done}/${totals.total} series</p>
      </div>
      <div class="last-session-metric">${formatDuration(session.durationSeconds)}</div>
    </div>`;
}

function renderHomeRecords() {
  const records = getPersonalRecords(state.history);
  const relevant = [...records.values()]
    .sort((a, b) => sessionTimestamp(b.session) - sessionTimestamp(a.session))
    .slice(0, 4);

  if (!relevant.length) {
    elements.homeRecords.innerHTML = '<div class="empty-state">Tus mejores series aparecerán aquí</div>';
    return;
  }

  elements.homeRecords.innerHTML = relevant.map((record) => `
    <div class="record-row">
      <div>
        <strong>${escapeHtml(record.name)}</strong>
        <p>${escapeHtml(formatDate(record.date))}</p>
      </div>
      <div class="record-value">${formatRecord(record)}</div>
    </div>`).join("");
}

function handleHomeRoutineSelection(event) {
  const button = event.target.closest("[data-routine-id]");
  if (!button) return;
  state.settings.selectedRoutineId = button.dataset.routineId;
  saveState();
  renderHomeRoutine();
  renderHomeRecords();
}

function startWorkout() {
  const routineId = state.settings.selectedRoutineId;
  const routine = state.routines.find((item) => item.id === routineId);
  if (!routine?.exercises.length) {
    showToast("Añade al menos un ejercicio a la rutina.");
    return;
  }

  try {
    state = createWorkoutSession(state, routineId);
    timerCompletionHandled = false;
    saveState();
    render();
    window.scrollTo({ top: 0 });
  } catch (error) {
    showToast(error.message);
  }
}

function renderSession() {
  const session = state.activeSession;
  if (!session) return;
  const totals = getSessionTotals(session);
  const percentage = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

  elements.sessionRoutineName.textContent = session.routineName;
  elements.sessionStartedLabel.textContent = `En curso · ${formatClockTime(session.startedAt)}`;
  elements.sessionProgressText.textContent = `${totals.done} de ${totals.total} series`;
  elements.sessionProgressPercent.textContent = `${percentage}%`;
  elements.sessionProgressBar.style.width = `${percentage}%`;
  elements.sessionExerciseList.innerHTML = session.exercises.map(sessionExerciseHtml).join("");
  renderTimer();
}

function sessionExerciseHtml(exercise) {
  const completed = exercise.sets.filter((set) => set.done).length;
  const unit = exercise.measure === "seconds" ? "seg" : "reps";
  return `
    <article class="exercise-card" data-session-exercise-id="${escapeAttribute(exercise.id)}">
      <div class="exercise-header">
        <div>
          <h2>${escapeHtml(exercise.name)}</h2>
          <p>${exercise.sets.length} series · ${exercise.sets[0]?.target || 0} ${unit}</p>
        </div>
        <span class="exercise-progress">${completed}/${exercise.sets.length}</span>
      </div>
      <div class="set-list">
        ${exercise.sets.map((set, index) => sessionSetHtml(exercise, set, index)).join("")}
      </div>
    </article>`;
}

function sessionSetHtml(exercise, set, index) {
  const isTime = exercise.measure === "seconds";
  const previous = set.previousWeight
    ? `<small class="previous-weight">Anterior ${escapeHtml(set.previousWeight)} kg</small>`
    : '<small class="previous-weight">Sin peso anterior</small>';
  return `
    <div class="set-row ${isTime ? "time-row" : ""} ${set.done ? "done" : ""}" data-set-index="${index}">
      <span class="set-index">${index + 1}</span>
      <div class="set-target">${set.target} ${isTime ? "seg" : "reps"}${isTime ? "" : previous}</div>
      ${isTime ? "" : `
        <label class="weight-input" aria-label="Peso de la serie ${index + 1}">
          <input type="number" inputmode="decimal" min="0" step="0.5" value="${escapeAttribute(set.weight)}" data-session-weight>
          <span>kg</span>
        </label>`}
      <button class="done-button ${set.done ? "done" : ""}" type="button" data-toggle-set aria-label="${set.done ? "Desmarcar" : "Completar"} serie ${index + 1}" aria-pressed="${set.done}">✓</button>
    </div>`;
}

function handleSessionInput(event) {
  if (!event.target.matches("[data-session-weight]") || !state.activeSession) return;
  const exerciseElement = event.target.closest("[data-session-exercise-id]");
  const setElement = event.target.closest("[data-set-index]");
  const exercise = state.activeSession.exercises.find((item) => item.id === exerciseElement?.dataset.sessionExerciseId);
  const set = exercise?.sets[Number(setElement?.dataset.setIndex)];
  if (!set) return;
  set.weight = cleanInputWeight(event.target.value);
  saveState();
}

function handleSessionClick(event) {
  const button = event.target.closest("[data-toggle-set]");
  if (!button || !state.activeSession) return;
  const exerciseElement = button.closest("[data-session-exercise-id]");
  const setElement = button.closest("[data-set-index]");
  const exercise = state.activeSession.exercises.find((item) => item.id === exerciseElement?.dataset.sessionExerciseId);
  const set = exercise?.sets[Number(setElement?.dataset.setIndex)];
  if (!set) return;

  set.done = !set.done;
  set.completedAt = set.done ? new Date().toISOString() : null;
  if (set.done) startRestTimer();
  saveState();
  renderSession();
}

function finishWorkout() {
  if (!state.activeSession) return;
  const totals = getSessionTotals(state.activeSession);
  if (!totals.done) {
    showToast("Completa al menos una serie antes de guardar.");
    return;
  }

  state = completeWorkoutSession(state);
  currentView = "history";
  timerCompletionHandled = false;
  saveState();
  render();
  showToast("Entrenamiento guardado.");
  window.scrollTo({ top: 0 });
}

function confirmDiscardWorkout() {
  if (!state.activeSession) return;
  state = discardWorkoutSession(state);
  currentView = "home";
  timerCompletionHandled = false;
  saveState();
  render();
  showToast("Entrenamiento desechado.");
  window.scrollTo({ top: 0 });
}

function startRestTimer() {
  const timer = state.activeSession?.restTimer;
  if (!timer) return;
  const duration = clampNumber(state.settings.restSeconds, 10, 600, 90);
  timer.duration = duration;
  timer.remaining = duration;
  timer.running = true;
  timer.endsAt = Date.now() + duration * 1000;
  timerCompletionHandled = false;
}

function toggleRestTimer() {
  const timer = state.activeSession?.restTimer;
  if (!timer) return;
  if (timer.running) {
    timer.remaining = effectiveTimerRemaining(timer);
    timer.running = false;
    timer.endsAt = null;
  } else {
    if (timer.remaining <= 0) timer.remaining = timer.duration;
    timer.running = true;
    timer.endsAt = Date.now() + timer.remaining * 1000;
    timerCompletionHandled = false;
  }
  saveState();
  renderTimer();
}

function resetRestTimer() {
  const timer = state.activeSession?.restTimer;
  if (!timer) return;
  const duration = clampNumber(state.settings.restSeconds, 10, 600, 90);
  Object.assign(timer, { duration, remaining: duration, running: false, endsAt: null });
  timerCompletionHandled = false;
  saveState();
  renderTimer();
}

function effectiveTimerRemaining(timer) {
  if (!timer?.running || !timer.endsAt) return Math.max(0, Number(timer?.remaining) || 0);
  return Math.max(0, Math.ceil((Number(timer.endsAt) - Date.now()) / 1000));
}

function renderTimer() {
  const timer = state.activeSession?.restTimer;
  if (!timer) return;
  const remaining = effectiveTimerRemaining(timer);
  elements.timerDisplay.textContent = formatTimer(remaining);
  elements.timerToggleButton.textContent = timer.running ? "Pausar" : remaining === 0 ? "Repetir" : "Iniciar";
}

function tickClocks() {
  const session = state.activeSession;
  if (!session) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(session.startedAt)) / 1000));
  elements.sessionElapsed.textContent = formatTimer(elapsed, true);
  const timer = session.restTimer;
  if (!timer) return;

  const remaining = effectiveTimerRemaining(timer);
  elements.timerDisplay.textContent = formatTimer(remaining);
  if (timer.running && remaining === 0 && !timerCompletionHandled) {
    timerCompletionHandled = true;
    Object.assign(timer, { remaining: 0, running: false, endsAt: null });
    saveState();
    renderTimer();
    if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
    showToast("Descanso terminado.");
  }
}

function handleReadinessCheckin(event) {
  const field = event.currentTarget.dataset.readinessField;
  const value = event.currentTarget.dataset.value;
  if (state.readiness.date !== todayKey()) {
    state.readiness = { ...emptyReadiness(), date: todayKey() };
  }
  const nextValue = state.readiness[field] === value ? null : value;
  state.readiness = updateReadinessCheckin(state.readiness, field, nextValue);
  saveState();
  renderReadiness();
}

function processReadinessReturn() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const encoded = hashParams.get("readiness") || url.searchParams.get("readiness") || url.searchParams.get("result");
  if (!encoded) return;

  try {
    const payload = JSON.parse(encoded);
    state.readiness = normalizeReadinessPayload(payload, state.readiness);
    url.hash = "";
    url.searchParams.delete("readiness");
    url.searchParams.delete("result");
    window.history.replaceState({}, document.title, url.toString());
    showToast(state.readiness.score === null ? "Readiness: datos insuficientes." : "Readiness actualizado.");
  } catch (error) {
    console.error("Resultado de readiness no válido", error);
    showToast("No se pudo leer el resultado de Apple Salud.");
  }
}

function launchReadinessShortcut() {
  const shortcutName = state.settings.shortcutName.trim() || "Calcular Readiness";
  const callbackUrl = `${window.location.origin}${window.location.pathname}`;
  showToast("Abriendo Atajos…");
  window.location.href = buildShortcutRunUrl(shortcutName, callbackUrl);
}

function renderHistory() {
  const sessions = [...state.history].sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a));
  elements.historyCount.textContent = String(sessions.length);
  elements.historyList.innerHTML = sessions.length
    ? sessions.map(historySessionHtml).join("")
    : '<div class="empty-state">Guarda un entrenamiento para empezar el historial</div>';
  renderProgressOptions();
  if (currentView === "history") requestAnimationFrame(renderProgress);
}

function historySessionHtml(session) {
  const totals = getSessionTotals(session);
  const readiness = Number.isFinite(session.readiness?.score)
    ? `<span>Readiness ${session.readiness.score}</span>`
    : "";
  return `
    <details class="history-card">
      <summary>
        <div>
          <strong>${escapeHtml(session.routineName)}</strong>
          <p>${escapeHtml(formatDate(session.completedAt))} · ${formatDuration(session.durationSeconds)}</p>
        </div>
        <div class="history-score">${totals.done}/${totals.total}${readiness}</div>
      </summary>
      <div class="history-detail">
        ${(session.exercises || []).map(historyExerciseHtml).join("")}
      </div>
    </details>`;
}

function historyExerciseHtml(exercise) {
  const unit = exercise.measure === "seconds" ? "seg" : "reps";
  return `
    <div class="history-exercise">
      <strong>${escapeHtml(exercise.name)}</strong>
      <p>${exercise.sets.length} series · ${exercise.sets[0]?.target || 0} ${unit}</p>
      <div class="history-set-list">
        ${exercise.sets.map((set, index) => {
          const value = exercise.measure === "seconds"
            ? `${set.target} seg`
            : `${set.weight || "--"} kg · ${set.target} reps`;
          return `<span class="${set.done ? "done" : ""}">${index + 1}: ${escapeHtml(value)}</span>`;
        }).join("")}
      </div>
    </div>`;
}

function renderProgressOptions() {
  const exercises = new Map();
  for (const routine of state.routines) {
    for (const exercise of routine.exercises) {
      exercises.set(exercise.id, { key: exercise.id, name: exercise.name, routineName: routine.name });
    }
  }
  for (const session of state.history) {
    for (const exercise of session.exercises || []) {
      const key = exercise.templateExerciseId || normalizeName(exercise.name);
      if (!exercises.has(key)) exercises.set(key, { key, name: exercise.name, routineName: session.routineName });
    }
  }

  const options = [...exercises.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  const nameCounts = options.reduce((counts, option) => {
    const name = normalizeName(option.name);
    counts.set(name, (counts.get(name) || 0) + 1);
    return counts;
  }, new Map());
  options.forEach((option) => {
    option.label = nameCounts.get(normalizeName(option.name)) > 1 && option.routineName
      ? option.name + " · " + option.routineName
      : option.name;
  });
  if (!options.some((option) => option.key === progressExerciseKey)) {
    const latestExercise = getLatestSession(state.history)?.exercises?.find((exercise) =>
      exercise.sets?.some((set) => set.done)
    );
    const latestKey = latestExercise?.templateExerciseId || normalizeName(latestExercise?.name);
    progressExerciseKey = options.find((option) => option.key === latestKey)?.key
      || options.find((option) => getExerciseProgress(state.history, option.key).length)?.key
      || options[0]?.key
      || "";
  }
  elements.progressExerciseSelect.innerHTML = options.length
    ? options.map((option) => `<option value="${escapeAttribute(option.key)}" ${option.key === progressExerciseKey ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")
    : '<option value="">Sin ejercicios</option>';
}

function renderProgress() {
  const points = progressExerciseKey ? getExerciseProgress(state.history, progressExerciseKey) : [];
  const latest = points.at(-1);
  const record = points.length ? points.reduce((best, point) => point.value > best.value ? point : best) : null;
  elements.progressLatest.textContent = latest ? formatProgressValue(latest) : "--";
  elements.progressRecord.textContent = record ? formatProgressValue(record) : "--";
  drawProgressChart(points);
}

function drawProgressChart(points) {
  const canvas = elements.progressChart;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width || 320));
  const height = 168;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const padding = { top: 16, right: 12, bottom: 28, left: 12 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  context.strokeStyle = "#e1e5e1";
  context.lineWidth = 1;
  for (let row = 0; row <= 3; row += 1) {
    const y = padding.top + (plotHeight / 3) * row;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }

  if (!points.length) {
    context.fillStyle = "#68706d";
    context.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
    context.textAlign = "center";
    context.fillText("Completa series para ver tu evolución", width / 2, height / 2 + 4);
    return;
  }

  const values = points.map((point) => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min = Math.max(0, min - Math.max(1, min * 0.1));
    max += Math.max(1, max * 0.1);
  }
  const coordinates = points.map((point, index) => ({
    x: points.length === 1 ? width / 2 : padding.left + (plotWidth * index) / (points.length - 1),
    y: padding.top + plotHeight - ((point.value - min) / (max - min)) * plotHeight
  }));

  context.strokeStyle = "#26735f";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.beginPath();
  coordinates.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.stroke();
  coordinates.forEach((point) => {
    context.beginPath();
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#26735f";
    context.lineWidth = 2;
    context.arc(point.x, point.y, 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });

  context.fillStyle = "#68706d";
  context.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
  context.textAlign = "left";
  context.fillText(formatShortDate(points[0].date), padding.left, height - 7);
  if (points.length > 1) {
    context.textAlign = "right";
    context.fillText(formatShortDate(points.at(-1).date), width - padding.right, height - 7);
  }
}

function renderRoutines() {
  if (!state.routines.some((routine) => routine.id === editorRoutineId)) {
    editorRoutineId = state.settings.selectedRoutineId || state.routines[0]?.id || "";
  }
  const routine = state.routines.find((item) => item.id === editorRoutineId);
  const suggestedId = getSuggestedRoutineId(state);
  elements.editorRoutineSelector.innerHTML = routineSelectorHtml(
    state.routines,
    editorRoutineId,
    suggestedId,
    "editor-routine"
  );
  elements.editorRoutineName.textContent = routine?.name || "Sin rutina";
  elements.editableExerciseList.innerHTML = routine?.exercises.length
    ? routine.exercises.map((exercise, index) => editableExerciseHtml(exercise, index, routine.exercises.length)).join("")
    : '<div class="empty-state">Añade el primer ejercicio de esta rutina</div>';
  elements.deleteRoutineButton.disabled = state.routines.length <= 1;
}

function editableExerciseHtml(exercise, index, total) {
  return `
    <article class="edit-exercise" data-template-exercise-id="${escapeAttribute(exercise.id)}">
      <div class="edit-exercise-header">
        <input type="text" value="${escapeAttribute(exercise.name)}" data-edit-field="name" aria-label="Nombre del ejercicio">
        <div class="reorder-actions">
          <button type="button" data-edit-action="move-up" aria-label="Subir ejercicio" ${index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" data-edit-action="move-down" aria-label="Bajar ejercicio" ${index === total - 1 ? "disabled" : ""}>↓</button>
        </div>
      </div>
      <div class="form-grid three-columns">
        <label><span>Series</span><input type="number" min="1" max="12" value="${exercise.setCount}" data-edit-field="setCount"></label>
        <label><span>Objetivo</span><input type="number" min="1" max="999" value="${exercise.target}" data-edit-field="target"></label>
        <label><span>Unidad</span><select data-edit-field="measure"><option value="reps" ${exercise.measure === "reps" ? "selected" : ""}>Reps</option><option value="seconds" ${exercise.measure === "seconds" ? "selected" : ""}>Seg</option></select></label>
      </div>
      <label class="edit-weight" ${exercise.measure === "seconds" ? "hidden" : ""}>
        <span>Peso inicial (kg)</span>
        <input type="number" inputmode="decimal" min="0" step="0.5" value="${escapeAttribute(exercise.defaultWeight)}" data-edit-field="defaultWeight">
      </label>
      <div class="edit-exercise-actions">
        <button class="secondary-button" type="button" data-edit-action="save">Guardar</button>
        <button class="danger-button" type="button" data-edit-action="remove">Quitar</button>
      </div>
    </article>`;
}

function handleEditorRoutineSelection(event) {
  const button = event.target.closest("[data-routine-id]");
  if (!button) return;
  editorRoutineId = button.dataset.routineId;
  renderRoutines();
}

function addRoutine() {
  const name = window.prompt("Nombre de la nueva rutina", `Rutina ${state.routines.length + 1}`)?.trim();
  if (!name) return;
  const routine = { id: createId(), name: name.slice(0, 60), exercises: [] };
  state.routines.push(routine);
  editorRoutineId = routine.id;
  state.settings.selectedRoutineId = routine.id;
  saveState();
  render();
  showToast("Rutina añadida.");
}

function renameRoutine() {
  const routine = currentEditorRoutine();
  if (!routine) return;
  const name = window.prompt("Nombre de la rutina", routine.name)?.trim();
  if (!name) return;
  routine.name = name.slice(0, 60);
  saveState();
  render();
}

function deleteRoutine() {
  const routine = currentEditorRoutine();
  if (!routine || state.routines.length <= 1) return;
  if (!window.confirm(`¿Eliminar ${routine.name}? El historial guardado se conservará.`)) return;
  state.routines = state.routines.filter((item) => item.id !== routine.id);
  editorRoutineId = state.routines[0].id;
  if (state.settings.selectedRoutineId === routine.id) {
    state.settings.selectedRoutineId = getSuggestedRoutineId(state) || editorRoutineId;
  }
  saveState();
  render();
  showToast("Rutina eliminada.");
}

function handleRoutineEditorChange(event) {
  if (!event.target.matches('[data-edit-field="measure"]')) return;
  const article = event.target.closest("[data-template-exercise-id]");
  const weightLabel = article?.querySelector(".edit-weight");
  if (weightLabel) weightLabel.hidden = event.target.value === "seconds";
}

function handleRoutineEditorClick(event) {
  const button = event.target.closest("[data-edit-action]");
  if (!button) return;
  const routine = currentEditorRoutine();
  const article = button.closest("[data-template-exercise-id]");
  const exerciseIndex = routine?.exercises.findIndex((item) => item.id === article?.dataset.templateExerciseId) ?? -1;
  if (!routine || exerciseIndex < 0) return;
  const action = button.dataset.editAction;

  if (action === "move-up" && exerciseIndex > 0) {
    [routine.exercises[exerciseIndex - 1], routine.exercises[exerciseIndex]] = [routine.exercises[exerciseIndex], routine.exercises[exerciseIndex - 1]];
  } else if (action === "move-down" && exerciseIndex < routine.exercises.length - 1) {
    [routine.exercises[exerciseIndex + 1], routine.exercises[exerciseIndex]] = [routine.exercises[exerciseIndex], routine.exercises[exerciseIndex + 1]];
  } else if (action === "remove") {
    if (!window.confirm(`¿Quitar ${routine.exercises[exerciseIndex].name} de la plantilla?`)) return;
    routine.exercises.splice(exerciseIndex, 1);
  } else if (action === "save") {
    const values = Object.fromEntries(
      [...article.querySelectorAll("[data-edit-field]")].map((input) => [input.dataset.editField, input.value])
    );
    const name = values.name.trim();
    if (!name) {
      showToast("El ejercicio necesita un nombre.");
      return;
    }
    routine.exercises[exerciseIndex] = {
      ...routine.exercises[exerciseIndex],
      name: name.slice(0, 80),
      setCount: clampNumber(values.setCount, 1, 12, 3),
      target: clampNumber(values.target, 1, 999, 10),
      measure: values.measure === "seconds" ? "seconds" : "reps",
      defaultWeight: values.measure === "seconds" ? "" : cleanInputWeight(values.defaultWeight)
    };
    showToast("Ejercicio actualizado.");
  } else {
    return;
  }

  saveState();
  renderRoutines();
}

function addExercise(event) {
  event.preventDefault();
  const routine = currentEditorRoutine();
  if (!routine) return;
  const name = elements.exerciseNameInput.value.trim();
  if (!name) return;
  const measure = elements.exerciseMeasureInput.value === "seconds" ? "seconds" : "reps";
  routine.exercises.push({
    id: createId(),
    name: name.slice(0, 80),
    setCount: clampNumber(elements.exerciseSetsInput.value, 1, 12, 3),
    target: clampNumber(elements.exerciseTargetInput.value, 1, 999, 10),
    measure,
    defaultWeight: measure === "seconds" ? "" : cleanInputWeight(elements.exerciseWeightInput.value)
  });
  saveState();
  elements.addExerciseForm.reset();
  elements.exerciseSetsInput.value = "3";
  elements.exerciseTargetInput.value = "10";
  updateAddExerciseFields();
  renderRoutines();
  showToast("Ejercicio añadido.");
}

function updateAddExerciseFields() {
  elements.exerciseWeightLabel.hidden = elements.exerciseMeasureInput.value === "seconds";
}

function currentEditorRoutine() {
  return state.routines.find((routine) => routine.id === editorRoutineId);
}

function openSettings() {
  elements.restSecondsInput.value = String(state.settings.restSeconds);
  elements.shortcutNameInput.value = state.settings.shortcutName;
  openDialog(elements.settingsDialog);
}

function saveSettings() {
  const restSeconds = clampNumber(elements.restSecondsInput.value, 10, 600, state.settings.restSeconds);
  state.settings.restSeconds = restSeconds;
  state.settings.shortcutName = elements.shortcutNameInput.value.trim().slice(0, 80) || "Calcular Readiness";
  if (state.activeSession && !state.activeSession.restTimer.running) {
    state.activeSession.restTimer.duration = restSeconds;
    state.activeSession.restTimer.remaining = restSeconds;
  }
  saveState();
  if (state.activeSession) renderTimer();
}

function backupJson() {
  return JSON.stringify({
    ...cloneData(state),
    exportedAt: new Date().toISOString(),
    app: "Gym Tracker"
  }, null, 2);
}

function backupFile() {
  return new File([backupJson()], `gym-tracker-${todayKey()}.json`, { type: "application/json" });
}

async function shareBackup() {
  const file = backupFile();
  try {
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: "Copia de Gym Tracker", files: [file] });
      return;
    }
    downloadFile(file);
    showToast("Copia descargada.");
  } catch (error) {
    if (error.name !== "AbortError") showToast("No se pudo compartir la copia.");
  }
}

function downloadBackup() {
  downloadFile(backupFile());
  showToast("Copia descargada.");
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const imported = normalizeState(JSON.parse(await file.text()));
    if (!window.confirm("¿Sustituir los datos actuales por esta copia?")) return;
    state = imported;
    elements.restSecondsInput.value = String(imported.settings.restSeconds);
    elements.shortcutNameInput.value = imported.settings.shortcutName;
    editorRoutineId = state.settings.selectedRoutineId;
    currentView = state.activeSession ? "session" : "home";
    saveState();
    if (elements.settingsDialog.open) elements.settingsDialog.close();
    render();
    showToast("Copia importada.");
  } catch (error) {
    console.error("Copia no válida", error);
    showToast("El archivo no es una copia válida.");
  }
}

function routineSelectorHtml(routines, selectedId, suggestedId, source) {
  return routines.map((routine) => `
    <button class="routine-button ${routine.id === selectedId ? "active" : ""} ${routine.id === suggestedId ? "suggested" : ""}"
      type="button" data-routine-id="${escapeAttribute(routine.id)}" data-source="${source}"
      aria-pressed="${routine.id === selectedId}" title="${escapeAttribute(routine.name)}">
      ${escapeHtml(shortRoutineName(routine.name))}
    </button>`).join("");
}

function processServiceWorker(registration) {
  if (registration.waiting) showServiceWorkerUpdate(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        showServiceWorkerUpdate(worker);
      }
    });
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js");
    processServiceWorker(registration);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });
  } catch (error) {
    console.warn("Service worker no disponible", error);
  }
}

function showServiceWorkerUpdate(worker) {
  waitingServiceWorker = worker;
  elements.updateToast.hidden = false;
  window.setTimeout(() => {
    if (waitingServiceWorker === worker) elements.updateToast.hidden = true;
  }, 8000);
}

function applyServiceWorkerUpdate() {
  waitingServiceWorker?.postMessage({ type: "SKIP_WAITING" });
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function showToast(message) {
  clearTimeout(toastTimeout);
  elements.appToast.textContent = message;
  elements.appToast.hidden = false;
  toastTimeout = setTimeout(() => {
    elements.appToast.hidden = true;
  }, 2800);
}

function formatRecord(record) {
  return record.measure === "seconds"
    ? `${formatNumber(record.value)} seg`
    : `${formatNumber(record.value)} kg · ${formatNumber(record.target)} reps`;
}

function formatProgressValue(point) {
  return point.measure === "seconds" ? `${formatNumber(point.value)} seg` : `${formatNumber(point.value)} kg`;
}

function formatDate(value) {
  const date = parseDate(value);
  return Number.isNaN(date.getTime()) ? "Fecha desconocida" : dateFormatter.format(date);
}

function formatShortDate(value) {
  const date = parseDate(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }).format(date);
}

function formatClockTime(value) {
  const date = parseDate(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function parseDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return new Date(`${value}T12:00:00`);
  return new Date(value);
}

function formatDuration(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.round(safe / 60);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function formatTimer(seconds, allowHours = false) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  if (allowHours && hours) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${String(hours * 60 + minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function shortRoutineName(name) {
  const match = String(name).match(/^rutina\s+(.+)$/i);
  return match ? match[1] : name;
}

function sessionTimestamp(session) {
  return Date.parse(session?.completedAt || session?.date || session?.startedAt || 0) || 0;
}

function cleanInputWeight(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return "";
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? String(number) : "";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

document.title = "Gym Tracker";
elements.todayLabel.textContent = weekdayFormatter.format(new Date());
