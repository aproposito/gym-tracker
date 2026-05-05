const STORAGE_KEY = "gymTracker.v1";
const ROUTINE_TEMPLATE_VERSION = 3;

const defaultState = {
  restSeconds: 90,
  activeDate: todayKey(),
  activeRoutineId: "routine-a",
  routineTemplateVersion: ROUTINE_TEMPLATE_VERSION,
  routines: buildDefaultRoutines(),
  history: []
};

let state = loadState();
let timer = {
  total: state.restSeconds,
  left: state.restSeconds,
  running: false,
  intervalId: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const elements = {
  todayLabel: $("#todayLabel"),
  progressValue: $("#progressValue"),
  doneSetsValue: $("#doneSetsValue"),
  activeRoutineName: $("#activeRoutineName"),
  routineSelector: $("#routineSelector"),
  finishWorkoutButton: $("#finishWorkoutButton"),
  abortWorkoutButton: $("#abortWorkoutButton"),
  resetTodayButton: $("#resetTodayButton"),
  exerciseList: $("#exerciseList"),
  workoutSubtitle: $("#workoutSubtitle"),
  editableExerciseList: $("#editableExerciseList"),
  historyList: $("#historyList"),
  addExerciseForm: $("#addExerciseForm"),
  exerciseNameInput: $("#exerciseNameInput"),
  exerciseSetsInput: $("#exerciseSetsInput"),
  exerciseRepsInput: $("#exerciseRepsInput"),
  exerciseWeightInput: $("#exerciseWeightInput"),
  restSecondsInput: $("#restSecondsInput"),
  timerDisplay: $("#timerDisplay"),
  timerStartButton: $("#timerStartButton"),
  timerResetButton: $("#timerResetButton"),
  exportButton: $("#exportButton"),
  importInput: $("#importInput"),
  exportOutput: $("#exportOutput")
};

init();

function init() {
  if (state.activeDate !== todayKey()) {
    state.activeDate = todayKey();
    resetWorkoutProgress();
    saveState();
  }

  elements.todayLabel.textContent = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "short"
  }).format(new Date());

  elements.restSecondsInput.value = state.restSeconds;
  bindEvents();
  render();
  updateTimerDisplay();
  registerServiceWorker();
}

function bindEvents() {
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  elements.finishWorkoutButton.addEventListener("click", finishWorkout);
  elements.abortWorkoutButton.addEventListener("click", abortWorkout);
  elements.resetTodayButton.addEventListener("click", abortWorkout);

  elements.addExerciseForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addExercise();
  });

  elements.restSecondsInput.addEventListener("change", () => {
    const seconds = clampNumber(Number(elements.restSecondsInput.value), 10, 600, 90);
    state.restSeconds = seconds;
    elements.restSecondsInput.value = seconds;
    saveState();
    resetTimer();
  });

  elements.timerStartButton.addEventListener("click", toggleTimer);
  elements.timerResetButton.addEventListener("click", resetTimer);
  elements.exportButton.addEventListener("click", exportData);
  elements.importInput.addEventListener("change", importData);
}

function switchTab(tabName) {
  $$(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });

  $$(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${tabName}Panel`);
  });
}

function render() {
  renderRoutineSelector();
  renderSummary();
  renderExercises();
  renderEditor();
  renderHistory();
}

function renderRoutineSelector() {
  const activeRoutine = getActiveRoutine();
  elements.activeRoutineName.textContent = activeRoutine.name;
  elements.workoutSubtitle.textContent = activeRoutine.name;
  elements.routineSelector.innerHTML = "";

  state.routines.forEach((routine) => {
    const button = document.createElement("button");
    button.className = `routine-button ${routine.id === state.activeRoutineId ? "active" : ""}`;
    button.type = "button";
    button.textContent = routine.name.replace("Rutina ", "");
    button.setAttribute("aria-label", `Seleccionar ${routine.name}`);
    button.addEventListener("click", () => {
      selectRoutine(routine.id);
    });
    elements.routineSelector.append(button);
  });
}

function selectRoutine(routineId) {
  if (routineId === state.activeRoutineId) {
    switchTab("workout");
    return;
  }

  if (hasWorkoutProgress() && !confirm("Hay una sesión sin guardar. ¿Descartarla y cambiar de rutina?")) {
    return;
  }

  resetWorkoutProgress();
  state.activeRoutineId = routineId;
  saveAndRender();
  resetTimer();
  switchTab("workout");
}

function renderSummary() {
  const totals = getTotals();
  const percent = totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100);
  elements.progressValue.textContent = `${percent}%`;
  elements.doneSetsValue.textContent = `${totals.done}/${totals.total}`;
}

function renderExercises() {
  elements.exerciseList.innerHTML = "";
  const exercises = getActiveExercises();

  if (exercises.length === 0) {
    elements.exerciseList.append(emptyState("No hay ejercicios. Anade uno en Editar."));
    return;
  }

  exercises.forEach((exercise) => {
    const doneSets = exercise.sets.filter((set) => set.done).length;
    const card = document.createElement("article");
    card.className = "exercise-card";
    card.innerHTML = `
      <div class="exercise-header">
        <div>
          <h3>${escapeHtml(exercise.name)}</h3>
          <p>${exercise.sets.length} series programadas</p>
        </div>
        <span class="exercise-progress">${doneSets}/${exercise.sets.length}</span>
      </div>
      <div class="set-list"></div>
    `;

    const list = card.querySelector(".set-list");
    exercise.sets.forEach((set, setIndex) => {
      const row = document.createElement("div");
      row.className = "set-row";
      row.innerHTML = `
        <span class="set-index">${setIndex + 1}</span>
        <span class="set-target">${escapeHtml(set.reps)} reps</span>
        <input type="number" inputmode="decimal" min="0" step="0.5" value="${escapeHtml(set.weight)}" aria-label="Peso serie ${setIndex + 1}">
        <button class="done-button ${set.done ? "done" : ""}" type="button" aria-label="Marcar serie ${setIndex + 1}">✓</button>
      `;

      row.querySelector("input").addEventListener("input", (event) => {
        set.weight = event.target.value;
        saveState();
      });

      row.querySelector("button").addEventListener("click", () => {
        set.done = !set.done;
        saveAndRender();
        if (set.done) {
          startTimerFromRest();
        }
      });

      list.append(row);
    });

    elements.exerciseList.append(card);
  });
}

function renderEditor() {
  elements.editableExerciseList.innerHTML = "";
  const exercises = getActiveExercises();

  if (exercises.length === 0) {
    elements.editableExerciseList.append(emptyState("La rutina esta vacia."));
    return;
  }

  exercises.forEach((exercise, exerciseIndex) => {
    const firstSet = exercise.sets[0] || { reps: "10", weight: "" };
    const row = document.createElement("article");
    row.className = "edit-row";
    row.innerHTML = `
      <input type="text" value="${escapeHtml(exercise.name)}" aria-label="Nombre del ejercicio">
      <div class="form-row">
        <input type="number" min="1" max="12" value="${exercise.sets.length}" aria-label="Series">
        <input type="text" value="${escapeHtml(firstSet.reps)}" aria-label="Repeticiones">
        <input type="number" min="0" step="0.5" value="${escapeHtml(firstSet.weight)}" placeholder="kg" aria-label="Peso objetivo">
      </div>
      <div class="edit-row-actions">
        <button class="secondary-button" type="button">Guardar</button>
        <button class="danger-button" type="button">Quitar</button>
      </div>
    `;

    const [nameInput, setsInput, repsInput, weightInput] = row.querySelectorAll("input");
    row.querySelector(".secondary-button").addEventListener("click", () => {
      updateExercise(exerciseIndex, {
        name: nameInput.value.trim() || "Ejercicio sin nombre",
        setCount: clampNumber(Number(setsInput.value), 1, 12, 3),
        reps: repsInput.value.trim() || "10",
        weight: weightInput.value
      });
    });

    row.querySelector(".danger-button").addEventListener("click", () => {
      if (confirm(`Quitar ${exercise.name}?`)) {
        getActiveExercises().splice(exerciseIndex, 1);
        saveAndRender();
      }
    });

    elements.editableExerciseList.append(row);
  });
}

function renderHistory() {
  elements.historyList.innerHTML = "";

  if (state.history.length === 0) {
    elements.historyList.append(emptyState("Aun no hay sesiones guardadas."));
    return;
  }

  state.history
    .slice()
    .reverse()
    .forEach((session) => {
      const card = document.createElement("article");
      card.className = "history-card";
      const completed = session.exercises.reduce((sum, exercise) => {
        return sum + exercise.sets.filter((set) => set.done).length;
      }, 0);
      const total = session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
      card.innerHTML = `
        <header>
          <strong>${escapeHtml(session.routineName || "Rutina")} - ${completed}/${total} series</strong>
          <time>${escapeHtml(session.label)}</time>
        </header>
        <ul>
          ${session.exercises.map((exercise) => `<li>${escapeHtml(exercise.name)}: ${exercise.sets.filter((set) => set.done).length}/${exercise.sets.length}</li>`).join("")}
        </ul>
      `;
      elements.historyList.append(card);
    });
}

function addExercise() {
  const name = elements.exerciseNameInput.value.trim();
  if (!name) {
    return;
  }

  const setCount = clampNumber(Number(elements.exerciseSetsInput.value), 1, 12, 3);
  const reps = elements.exerciseRepsInput.value.trim() || "10";
  const weight = elements.exerciseWeightInput.value;

  getActiveExercises().push({
    id: cryptoId(),
    name,
    sets: Array.from({ length: setCount }, () => ({ reps, weight, done: false }))
  });

  elements.addExerciseForm.reset();
  elements.exerciseSetsInput.value = 3;
  elements.exerciseRepsInput.value = "10";
  saveAndRender();
}

function updateExercise(index, values) {
  const exercises = getActiveExercises();
  const exercise = exercises[index];
  if (!exercise) {
    return;
  }

  const nextSets = Array.from({ length: values.setCount }, (_, setIndex) => {
    const existing = exercise.sets[setIndex];
    return {
      reps: values.reps,
      weight: existing?.weight || values.weight || "",
      done: existing?.done || false
    };
  });

  exercises[index] = {
    ...exercise,
    name: values.name,
    sets: nextSets
  };
  saveAndRender();
}

function finishWorkout() {
  const totals = getTotals();
  const activeRoutine = getActiveRoutine();
  if (totals.done === 0 && !confirm("No hay series marcadas. Guardar igualmente?")) {
    return;
  }

  state.history.push({
    id: cryptoId(),
    routineId: activeRoutine.id,
    routineName: activeRoutine.name,
    date: new Date().toISOString(),
    label: new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date()),
    exercises: cloneData(activeRoutine.exercises)
  });

  resetWorkoutProgress();
  saveAndRender();
  switchTab("history");
}

function abortWorkout() {
  if (!hasWorkoutProgress()) {
    resetTimer();
    switchTab("workout");
    return;
  }

  if (confirm("Abortar esta sesión sin guardarla en el historial?")) {
    resetWorkoutProgress();
    saveAndRender();
    resetTimer();
    switchTab("workout");
  }
}

function resetWorkoutProgress() {
  getActiveExercises().forEach((exercise) => {
    exercise.sets.forEach((set) => {
      set.done = false;
      set.weight = "";
    });
  });
}

function hasWorkoutProgress() {
  return getActiveExercises().some((exercise) => {
    return exercise.sets.some((set) => set.done || String(set.weight).trim() !== "");
  });
}

function getTotals() {
  return getActiveExercises().reduce(
    (totals, exercise) => {
      totals.total += exercise.sets.length;
      totals.done += exercise.sets.filter((set) => set.done).length;
      return totals;
    },
    { total: 0, done: 0 }
  );
}

function toggleTimer() {
  if (timer.running) {
    stopTimer();
    return;
  }
  startTimer();
}

function startTimerFromRest() {
  timer.total = state.restSeconds;
  timer.left = state.restSeconds;
  startTimer();
}

function startTimer() {
  stopTimer();
  timer.running = true;
  elements.timerStartButton.textContent = "Pausar";
  timer.intervalId = window.setInterval(() => {
    timer.left = Math.max(0, timer.left - 1);
    updateTimerDisplay();
    if (timer.left === 0) {
      stopTimer();
      navigator.vibrate?.(180);
    }
  }, 1000);
  updateTimerDisplay();
}

function stopTimer() {
  timer.running = false;
  elements.timerStartButton.textContent = "Iniciar";
  if (timer.intervalId) {
    window.clearInterval(timer.intervalId);
    timer.intervalId = null;
  }
}

function resetTimer() {
  stopTimer();
  timer.total = state.restSeconds;
  timer.left = state.restSeconds;
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const minutes = String(Math.floor(timer.left / 60)).padStart(2, "0");
  const seconds = String(timer.left % 60).padStart(2, "0");
  elements.timerDisplay.textContent = `${minutes}:${seconds}`;
}

function exportData() {
  elements.exportOutput.value = JSON.stringify(state, null, 2);
  elements.exportOutput.select();
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const nextState = JSON.parse(reader.result);
      validateImportedState(nextState);
      state = normalizeState(nextState);
      saveAndRender();
      resetTimer();
      alert("Datos importados correctamente.");
    } catch (error) {
      alert("No se pudo importar el archivo JSON.");
    } finally {
      elements.importInput.value = "";
    }
  });
  reader.readAsText(file);
}

function validateImportedState(value) {
  if (!value || !Array.isArray(value.history) || (!Array.isArray(value.routines) && !Array.isArray(value.exercises))) {
    throw new Error("Invalid backup");
  }
}

function saveAndRender() {
  saveState();
  render();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return cloneData(defaultState);
    }
    return normalizeState(JSON.parse(stored));
  } catch (error) {
    return cloneData(defaultState);
  }
}

function normalizeState(value) {
  const nextState = { ...cloneData(defaultState), ...value };
  if (!Array.isArray(value.routines) || value.routines.length === 0) {
    const migratedExercises = Array.isArray(value.exercises) ? value.exercises : cloneData(defaultState.routines[0].exercises);
    nextState.routines = cloneData(defaultState.routines);
    nextState.routines[0].exercises = migratedExercises;
  }

  nextState.routines = nextState.routines.map((routine, index) => ({
    id: routine.id || `routine-${index + 1}`,
    name: routine.name || `Rutina ${index + 1}`,
    exercises: Array.isArray(routine.exercises) ? routine.exercises : []
  }));

  if (nextState.routineTemplateVersion !== ROUTINE_TEMPLATE_VERSION) {
    const defaultRoutines = buildDefaultRoutines();
    replaceRoutine(nextState, defaultRoutines, "routine-a");
    replaceRoutine(nextState, defaultRoutines, "routine-b");
    nextState.routineTemplateVersion = ROUTINE_TEMPLATE_VERSION;
  }

  if (!nextState.routines.some((routine) => routine.id === nextState.activeRoutineId)) {
    nextState.activeRoutineId = nextState.routines[0].id;
  }

  delete nextState.exercises;
  return nextState;
}

function getActiveRoutine() {
  return state.routines.find((routine) => routine.id === state.activeRoutineId) || state.routines[0];
}

function getActiveExercises() {
  return getActiveRoutine().exercises;
}

function replaceRoutine(stateToUpdate, sourceRoutines, routineId) {
  const replacement = sourceRoutines.find((routine) => routine.id === routineId);
  if (!replacement) {
    return;
  }

  const index = stateToUpdate.routines.findIndex((routine) => routine.id === routineId);
  if (index >= 0) {
    stateToUpdate.routines[index] = replacement;
  } else {
    stateToUpdate.routines.push(replacement);
  }
}

function emptyState(message) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

function todayKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDefaultRoutines() {
  return [
    {
      id: "routine-a",
      name: "Rutina A",
      exercises: [
        {
          id: cryptoId(),
          name: "Remo",
          sets: [
            { reps: "9", weight: "", done: false },
            { reps: "9", weight: "", done: false },
            { reps: "9", weight: "", done: false }
          ]
        },
        {
          id: cryptoId(),
          name: "Hip thrust",
          sets: [
            { reps: "12", weight: "", done: false },
            { reps: "12", weight: "", done: false },
            { reps: "12", weight: "", done: false }
          ]
        },
        {
          id: cryptoId(),
          name: "Press maquina",
          sets: [
            { reps: "9", weight: "", done: false },
            { reps: "9", weight: "", done: false },
            { reps: "9", weight: "", done: false }
          ]
        },
        {
          id: cryptoId(),
          name: "Sentadillas goblet",
          sets: [
            { reps: "12", weight: "", done: false },
            { reps: "12", weight: "", done: false },
            { reps: "12", weight: "", done: false }
          ]
        },
        {
          id: cryptoId(),
          name: "Plancha",
          sets: [
            { reps: "60 seg", weight: "", done: false },
            { reps: "60 seg", weight: "", done: false }
          ]
        }
      ]
    },
    {
      id: "routine-b",
      name: "Rutina B",
      exercises: [
        {
          id: cryptoId(),
          name: "Sentadilla maquina",
          sets: [
            { reps: "9", weight: "", done: false },
            { reps: "9", weight: "", done: false },
            { reps: "9", weight: "", done: false }
          ]
        },
        {
          id: cryptoId(),
          name: "Jalon maquina",
          sets: [
            { reps: "9", weight: "", done: false },
            { reps: "9", weight: "", done: false },
            { reps: "9", weight: "", done: false }
          ]
        },
        {
          id: cryptoId(),
          name: "Press militar maquina",
          sets: [
            { reps: "9", weight: "", done: false },
            { reps: "9", weight: "", done: false },
            { reps: "9", weight: "", done: false }
          ]
        },
        {
          id: cryptoId(),
          name: "Curl femoral maquina",
          sets: [
            { reps: "10", weight: "", done: false },
            { reps: "10", weight: "", done: false },
            { reps: "10", weight: "", done: false }
          ]
        },
        {
          id: cryptoId(),
          name: "Maquina abdominal",
          sets: [
            { reps: "10", weight: "", done: false },
            { reps: "10", weight: "", done: false },
            { reps: "10", weight: "", done: false }
          ]
        }
      ]
    },
    {
      id: "routine-c",
      name: "Rutina C",
      exercises: [
        {
          id: cryptoId(),
          name: "Prensa de piernas",
          sets: [
            { reps: "12", weight: "", done: false },
            { reps: "12", weight: "", done: false },
            { reps: "12", weight: "", done: false }
          ]
        },
        {
          id: cryptoId(),
          name: "Curl femoral",
          sets: [
            { reps: "12", weight: "", done: false },
            { reps: "12", weight: "", done: false },
            { reps: "12", weight: "", done: false }
          ]
        },
        {
          id: cryptoId(),
          name: "Plancha",
          sets: [
            { reps: "40 seg", weight: "", done: false },
            { reps: "40 seg", weight: "", done: false },
            { reps: "40 seg", weight: "", done: false }
          ]
        }
      ]
    }
  ];
}

function cryptoId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}
