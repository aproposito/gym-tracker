export const STORAGE_KEY = "gymTracker.v2";
export const LEGACY_STORAGE_KEY = "gymTracker.v1";
export const SCHEMA_VERSION = 2;

const READINESS_ADJUSTMENTS = {
  energy: { low: -10, normal: 0, high: 5 },
  soreness: { low: 0, medium: -5, high: -15 }
};

export function createDefaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    routines: buildDefaultRoutines(),
    activeSession: null,
    history: [],
    readiness: emptyReadiness(),
    settings: {
      restSeconds: 90,
      selectedRoutineId: "routine-a",
      shortcutName: "Calcular Readiness"
    }
  };
}

export function normalizeState(value) {
  if (!value || typeof value !== "object") {
    return createDefaultState();
  }

  if (value.schemaVersion !== SCHEMA_VERSION || !value.settings) {
    return migrateLegacyState(value);
  }

  const fallback = createDefaultState();
  const routines = Array.isArray(value.routines) && value.routines.length
    ? value.routines.map(normalizeRoutine)
    : fallback.routines;
  const history = Array.isArray(value.history)
    ? value.history.map(normalizeHistorySession).filter(Boolean)
    : [];
  const settings = {
    ...fallback.settings,
    ...value.settings,
    restSeconds: clampInteger(value.settings?.restSeconds, 10, 600, 90)
  };

  if (!routines.some((routine) => routine.id === settings.selectedRoutineId)) {
    settings.selectedRoutineId = getSuggestedRoutineId({ routines, history });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    routines,
    activeSession: value.activeSession ? normalizeActiveSession(value.activeSession, settings.restSeconds) : null,
    history,
    readiness: normalizeStoredReadiness(value.readiness),
    settings
  };
}

export function migrateLegacyState(legacy) {
  const fallback = createDefaultState();
  const sourceRoutines = Array.isArray(legacy.routines) && legacy.routines.length
    ? legacy.routines
    : Array.isArray(legacy.exercises)
      ? [{ id: "routine-a", name: "Rutina A", exercises: legacy.exercises }]
      : fallback.routines;
  const routines = sourceRoutines.map(normalizeRoutine);
  const history = Array.isArray(legacy.history)
    ? legacy.history.map(normalizeHistorySession).filter(Boolean)
    : [];
  const selectedRoutineId = routines.some((routine) => routine.id === legacy.activeRoutineId)
    ? legacy.activeRoutineId
    : routines[0]?.id;
  const settings = {
    restSeconds: clampInteger(legacy.restSeconds, 10, 600, 90),
    selectedRoutineId,
    shortcutName: "Calcular Readiness"
  };
  const activeLegacyRoutine = sourceRoutines.find((routine) => routine.id === selectedRoutineId);
  const hasProgress = activeLegacyRoutine?.exercises?.some((exercise) =>
    Array.isArray(exercise.sets) && exercise.sets.some((set) => Boolean(set.done))
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    routines,
    activeSession: hasProgress
      ? legacyRoutineToSession(activeLegacyRoutine, settings.restSeconds)
      : null,
    history,
    readiness: emptyReadiness(),
    settings
  };
}

export function createWorkoutSession(state, routineId, options = {}) {
  const routine = state.routines.find((item) => item.id === routineId);
  if (!routine) {
    throw new Error("No se encuentra la rutina seleccionada.");
  }

  const now = options.now || new Date().toISOString();
  const idFactory = options.idFactory || createId;
  const previousSession = getLastRoutineSession(state.history, routine.id);
  const exercises = routine.exercises.map((exercise) => {
    const previousExercise = findSessionExercise(previousSession, exercise);
    const previousCompleted = previousExercise?.sets?.filter((set) => set.done) || [];

    return {
      id: idFactory(),
      templateExerciseId: exercise.id,
      name: exercise.name,
      measure: exercise.measure,
      sets: Array.from({ length: exercise.setCount }, (_, setIndex) => {
        const previousSet = previousExercise?.sets?.[setIndex] || previousCompleted[setIndex];
        const previousWeight = cleanWeight(previousSet?.weight);
        return {
          target: exercise.target,
          weight: exercise.measure === "reps"
            ? previousWeight || cleanWeight(exercise.defaultWeight)
            : "",
          previousWeight,
          done: false,
          completedAt: null
        };
      })
    };
  });

  return {
    ...cloneData(state),
    activeSession: {
      id: idFactory(),
      routineId: routine.id,
      routineName: routine.name,
      startedAt: now,
      readiness: readinessSnapshot(state.readiness),
      exercises,
      restTimer: {
        duration: state.settings.restSeconds,
        remaining: state.settings.restSeconds,
        running: false,
        endsAt: null
      }
    }
  };
}

export function completeWorkoutSession(state, options = {}) {
  if (!state.activeSession) {
    throw new Error("No hay un entrenamiento activo.");
  }

  const completedAt = options.completedAt || new Date().toISOString();
  const idFactory = options.idFactory || createId;
  const session = cloneData(state.activeSession);
  const startedTime = Date.parse(session.startedAt);
  const completedTime = Date.parse(completedAt);

  session.id ||= idFactory();
  session.completedAt = completedAt;
  session.durationSeconds = Number.isFinite(startedTime) && Number.isFinite(completedTime)
    ? Math.max(0, Math.round((completedTime - startedTime) / 1000))
    : 0;
  delete session.restTimer;

  const nextState = {
    ...cloneData(state),
    activeSession: null,
    history: [...state.history, session]
  };
  nextState.settings.selectedRoutineId = getSuggestedRoutineId(nextState);
  return nextState;
}

export function discardWorkoutSession(state) {
  return {
    ...cloneData(state),
    activeSession: null
  };
}

export function getSuggestedRoutineId(state) {
  const routines = state.routines || [];
  if (!routines.length) {
    return "";
  }

  const latest = [...(state.history || [])]
    .filter((session) => session.routineId)
    .sort((a, b) => sessionTime(b) - sessionTime(a))[0];
  if (!latest) {
    return routines[0].id;
  }

  const currentIndex = routines.findIndex((routine) => routine.id === latest.routineId);
  return currentIndex < 0 ? routines[0].id : routines[(currentIndex + 1) % routines.length].id;
}

export function getLastRoutineSession(history, routineId) {
  return [...(history || [])]
    .filter((session) => session.routineId === routineId)
    .sort((a, b) => sessionTime(b) - sessionTime(a))[0] || null;
}

export function getLatestSession(history) {
  return [...(history || [])].sort((a, b) => sessionTime(b) - sessionTime(a))[0] || null;
}

export function getSessionTotals(session) {
  return (session?.exercises || []).reduce(
    (totals, exercise) => {
      totals.total += exercise.sets.length;
      totals.done += exercise.sets.filter((set) => set.done).length;
      return totals;
    },
    { done: 0, total: 0 }
  );
}

export function getPersonalRecords(history) {
  const records = new Map();

  for (const session of history || []) {
    for (const exercise of session.exercises || []) {
      const key = exercise.templateExerciseId || normalizeName(exercise.name);
      for (const set of exercise.sets || []) {
        if (!set.done) continue;
        const value = exercise.measure === "seconds"
          ? Number(set.target)
          : Number(set.weight);
        if (!Number.isFinite(value) || value <= 0) continue;

        const existing = records.get(key);
        if (!existing || value > existing.value || (value === existing.value && sessionTime(session) > sessionTime(existing.session))) {
          records.set(key, {
            key,
            exerciseId: exercise.templateExerciseId || exercise.id,
            name: exercise.name,
            measure: exercise.measure || "reps",
            value,
            target: Number(set.target) || 0,
            date: session.completedAt || session.date || session.startedAt,
            session
          });
        }
      }
    }
  }

  return records;
}

export function getExerciseProgress(history, exerciseKey) {
  const points = [];

  for (const session of [...(history || [])].sort((a, b) => sessionTime(a) - sessionTime(b))) {
    const exercise = (session.exercises || []).find((item) =>
      item.templateExerciseId === exerciseKey || normalizeName(item.name) === exerciseKey
    );
    if (!exercise) continue;

    const values = exercise.sets
      .filter((set) => set.done)
      .map((set) => exercise.measure === "seconds" ? Number(set.target) : Number(set.weight))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) continue;

    points.push({
      date: session.completedAt || session.date || session.startedAt,
      value: Math.max(...values),
      measure: exercise.measure || "reps",
      name: exercise.name
    });
  }

  return points;
}

export function normalizeReadinessPayload(payload, previous = emptyReadiness()) {
  if (!payload || typeof payload !== "object") {
    throw new Error("El resultado de readiness no es válido.");
  }

  const availableMetrics = clampInteger(payload.availableMetrics ?? payload.metrics, 0, 3, 0);
  const objectiveScore = availableMetrics >= 2
    ? clampInteger(payload.objectiveScore ?? payload.score, 0, 100, 0)
    : null;
  const date = isDateKey(payload.date) ? payload.date : todayKey();
  const sameDay = previous?.date === date;
  const next = {
    date,
    objectiveScore,
    availableMetrics,
    confidence: availableMetrics === 3 ? "alta" : availableMetrics === 2 ? "media" : "insuficiente",
    factors: Array.isArray(payload.factors)
      ? payload.factors.slice(0, 3).map((factor) => String(factor).slice(0, 120))
      : [],
    energy: sameDay ? previous.energy || null : null,
    soreness: sameDay ? previous.soreness || null : null,
    updatedAt: new Date().toISOString()
  };

  return applyReadinessAdjustments(next);
}

export function updateReadinessCheckin(readiness, field, value) {
  if (!READINESS_ADJUSTMENTS[field] || !(value in READINESS_ADJUSTMENTS[field])) {
    return applyReadinessAdjustments({ ...readiness, [field]: null });
  }
  return applyReadinessAdjustments({ ...readiness, [field]: value });
}

export function applyReadinessAdjustments(readiness) {
  const objective = Number(readiness?.objectiveScore);
  if (!Number.isFinite(objective) || (readiness.availableMetrics || 0) < 2) {
    return {
      ...emptyReadiness(),
      ...readiness,
      score: null,
      band: "unknown",
      recommendation: "Datos insuficientes"
    };
  }

  const energyAdjustment = READINESS_ADJUSTMENTS.energy[readiness.energy] || 0;
  const sorenessAdjustment = READINESS_ADJUSTMENTS.soreness[readiness.soreness] || 0;
  const score = clampInteger(objective + energyAdjustment + sorenessAdjustment, 0, 100, objective);
  const band = score >= 70 ? "green" : score >= 45 ? "amber" : "red";
  const recommendation = band === "green"
    ? "Sesión prevista"
    : band === "amber"
      ? "Ajusta carga si lo necesitas"
      : "Prioriza una sesión suave";

  return { ...readiness, score, band, recommendation };
}

export function emptyReadiness() {
  return {
    date: "",
    objectiveScore: null,
    score: null,
    band: "unknown",
    confidence: "insuficiente",
    recommendation: "Sin calcular",
    factors: [],
    availableMetrics: 0,
    energy: null,
    soreness: null,
    updatedAt: null
  };
}

export function buildDefaultRoutines() {
  return [
    {
      id: "routine-a",
      name: "Rutina A",
      exercises: [
        templateExercise("a-row", "Remo", 3, 9),
        templateExercise("a-hip-thrust", "Hip thrust", 3, 12),
        templateExercise("a-chest-press", "Press máquina", 3, 9),
        templateExercise("a-goblet-squat", "Sentadillas goblet", 3, 12),
        templateExercise("a-plank", "Plancha", 2, 60, "seconds")
      ]
    },
    {
      id: "routine-b",
      name: "Rutina B",
      exercises: [
        templateExercise("b-machine-squat", "Sentadilla máquina", 3, 9),
        templateExercise("b-lat-pulldown", "Jalón máquina", 3, 9),
        templateExercise("b-shoulder-press", "Press militar máquina", 3, 9),
        templateExercise("b-leg-curl", "Curl femoral máquina", 3, 10),
        templateExercise("b-abdominal", "Máquina abdominal", 3, 10)
      ]
    },
    {
      id: "routine-c",
      name: "Rutina C",
      exercises: [
        templateExercise("c-leg-press", "Prensa de piernas", 3, 12),
        templateExercise("c-leg-curl", "Curl femoral", 3, 12),
        templateExercise("c-plank", "Plancha", 3, 40, "seconds")
      ]
    }
  ];
}

function templateExercise(id, name, setCount, target, measure = "reps") {
  return { id, name, setCount, target, measure, defaultWeight: "" };
}

function normalizeRoutine(routine, index = 0) {
  return {
    id: routine.id || `routine-${index + 1}-${createId()}`,
    name: String(routine.name || `Rutina ${index + 1}`).trim(),
    exercises: Array.isArray(routine.exercises)
      ? routine.exercises.map(normalizeTemplateExercise)
      : []
  };
}

function normalizeTemplateExercise(exercise, index = 0) {
  const legacySets = Array.isArray(exercise.sets) ? exercise.sets : [];
  const legacyTarget = legacySets[0]?.reps ?? legacySets[0]?.target;
  const parsed = parseTarget(exercise.target ?? legacyTarget ?? 10, exercise.measure);
  const defaultWeight = cleanWeight(
    exercise.defaultWeight ?? legacySets.find((set) => cleanWeight(set.weight))?.weight
  );

  return {
    id: exercise.id || `exercise-${index + 1}-${createId()}`,
    name: String(exercise.name || "Ejercicio sin nombre").trim(),
    setCount: clampInteger(exercise.setCount ?? legacySets.length, 1, 12, 3),
    target: clampInteger(parsed.target, 1, 999, 10),
    measure: parsed.measure,
    defaultWeight
  };
}

function normalizeHistorySession(session) {
  if (!session || !Array.isArray(session.exercises)) return null;
  const completedAt = session.completedAt || session.date || new Date().toISOString();
  return {
    id: session.id || createId(),
    routineId: session.routineId || "",
    routineName: session.routineName || "Rutina",
    startedAt: session.startedAt || completedAt,
    completedAt,
    durationSeconds: Math.max(0, Number(session.durationSeconds) || 0),
    readiness: session.readiness ? normalizeStoredReadiness(session.readiness) : null,
    exercises: session.exercises.map(normalizeSessionExercise)
  };
}

function normalizeActiveSession(session, restSeconds) {
  return {
    id: session.id || createId(),
    routineId: session.routineId || "",
    routineName: session.routineName || "Rutina",
    startedAt: session.startedAt || new Date().toISOString(),
    readiness: session.readiness ? normalizeStoredReadiness(session.readiness) : null,
    exercises: Array.isArray(session.exercises) ? session.exercises.map(normalizeSessionExercise) : [],
    restTimer: normalizeRestTimer(session.restTimer, restSeconds)
  };
}

function normalizeSessionExercise(exercise, index = 0) {
  const sourceSets = Array.isArray(exercise.sets) ? exercise.sets : [];
  const parsed = parseTarget(sourceSets[0]?.target ?? sourceSets[0]?.reps ?? exercise.target ?? 10, exercise.measure);
  return {
    id: exercise.id || `session-exercise-${index + 1}-${createId()}`,
    templateExerciseId: exercise.templateExerciseId || exercise.id || "",
    name: String(exercise.name || "Ejercicio sin nombre").trim(),
    measure: exercise.measure || parsed.measure,
    sets: sourceSets.map((set) => {
      const target = parseTarget(set.target ?? set.reps ?? parsed.target, exercise.measure || parsed.measure);
      return {
        target: clampInteger(target.target, 1, 999, parsed.target),
        weight: cleanWeight(set.weight),
        previousWeight: cleanWeight(set.previousWeight),
        done: Boolean(set.done),
        completedAt: set.completedAt || null
      };
    })
  };
}

function legacyRoutineToSession(routine, restSeconds) {
  const exercises = (routine.exercises || []).map((exercise) => {
    const normalized = normalizeSessionExercise(exercise);
    return {
      ...normalized,
      sets: normalized.sets.map((set) => ({ ...set, completedAt: set.done ? new Date().toISOString() : null }))
    };
  });
  return {
    id: createId(),
    routineId: routine.id || "routine-a",
    routineName: routine.name || "Rutina",
    startedAt: new Date().toISOString(),
    readiness: null,
    exercises,
    restTimer: normalizeRestTimer(null, restSeconds)
  };
}

function normalizeRestTimer(timer, restSeconds) {
  const duration = clampInteger(timer?.duration, 10, 600, restSeconds);
  return {
    duration,
    remaining: clampInteger(timer?.remaining, 0, 600, duration),
    running: Boolean(timer?.running && timer?.endsAt),
    endsAt: timer?.running && timer?.endsAt ? Number(timer.endsAt) : null
  };
}

function normalizeStoredReadiness(readiness) {
  if (!readiness || typeof readiness !== "object") return emptyReadiness();
  return applyReadinessAdjustments({
    ...emptyReadiness(),
    ...readiness,
    objectiveScore: readiness.objectiveScore !== null && readiness.objectiveScore !== "" && Number.isFinite(Number(readiness.objectiveScore)) ? Number(readiness.objectiveScore) : null,
    availableMetrics: clampInteger(readiness.availableMetrics, 0, 3, 0),
    factors: Array.isArray(readiness.factors) ? readiness.factors.slice(0, 3).map(String) : []
  });
}

function readinessSnapshot(readiness) {
  if (!readiness?.date || readiness.date !== todayKey()) return null;
  return cloneData(readiness);
}

function findSessionExercise(session, exercise) {
  if (!session) return null;
  return (session.exercises || []).find((item) => item.templateExerciseId === exercise.id)
    || (session.exercises || []).find((item) => normalizeName(item.name) === normalizeName(exercise.name))
    || null;
}

function parseTarget(value, explicitMeasure) {
  const text = String(value ?? "").toLocaleLowerCase("es-ES");
  const measure = explicitMeasure === "seconds" || /seg|sec|second/.test(text) ? "seconds" : "reps";
  const numeric = Number.parseInt(text.replace(/[^0-9]/g, ""), 10);
  return { measure, target: Number.isFinite(numeric) ? numeric : 10 };
}

function cleanWeight(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return "";
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric >= 0 ? String(numeric) : "";
}

function sessionTime(session) {
  return Date.parse(session?.completedAt || session?.date || session?.startedAt || 0) || 0;
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("es-ES");
}

export function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}
