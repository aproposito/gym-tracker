export const STORAGE_KEY = "gymTracker.v3";
export const LEGACY_STORAGE_KEYS = ["gymTracker.v2", "gymTracker.v1"];
export const SCHEMA_VERSION = 3;

// El ajuste subjetivo se mantiene comparable a la dispersión objetiva del score
// (sd ~9 puntos en el histórico). Antes movía ±25 y decidía por sí solo.
const READINESS_ADJUSTMENTS = {
  energy: { low: -6, normal: 0, high: 3 },
  soreness: { low: 0, medium: -3, high: -7 }
};

export const READINESS_BANDS = { green: 70, amber: 52 };

/**
 * Dos formas de entrenar, dos formas de progresar.
 *
 * TRICON: nueve repeticiones fijas (tres normales, tres isométricas de seis
 * segundos y tres excéntricas lentas). No se progresa en repeticiones porque el
 * formato es el que es; solo sube el peso, y más despacio que en volumen porque
 * el tiempo bajo tensión ya es muy alto.
 *
 * Volumen: se sube de 10 a 12 repeticiones con el mismo peso y solo después
 * aumenta la carga.
 */
export const EXERCISE_STYLES = {
  tricon: { reps: 9, fixedReps: true, sessionsToIncrease: 3 },
  volumen: { repsMin: 10, repsMax: 12, fixedReps: false, sessionsToIncrease: 2 }
};

export const TRICON_REPS = EXERCISE_STYLES.tricon.reps;
export const SESSIONS_AT_TOP_TO_INCREASE = EXERCISE_STYLES.volumen.sessionsToIncrease;
export const SESSIONS_BELOW_TO_DELOAD = 2;
export const MAX_INCREASE_RATIO = 0.05;
export const DELOAD_RATIO = 0.1;
export const STALE_SESSIONS = 3;

export function createDefaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    routines: buildDefaultRoutines(),
    activeSession: null,
    history: [],
    readiness: emptyReadiness(),
    healthDays: [],
    settings: {
      restSeconds: 90,
      selectedRoutineId: "routine-a",
      readinessEnabled: false
    }
  };
}

export function normalizeState(value) {
  if (!value || typeof value !== "object") {
    return createDefaultState();
  }

  if (value.schemaVersion !== SCHEMA_VERSION || !value.settings) {
    return migrateState(value);
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
    restSeconds: clampInteger(value.settings?.restSeconds, 10, 600, 90),
    readinessEnabled: Boolean(value.settings?.readinessEnabled)
  };
  delete settings.shortcutName;

  if (!routines.some((routine) => routine.id === settings.selectedRoutineId)) {
    settings.selectedRoutineId = getSuggestedRoutineId({ routines, history });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    routines,
    activeSession: value.activeSession ? normalizeActiveSession(value.activeSession, settings.restSeconds) : null,
    history,
    readiness: normalizeStoredReadiness(value.readiness),
    healthDays: normalizeHealthDays(value.healthDays),
    settings
  };
}

export function migrateState(value) {
  if (value.schemaVersion === 2 && value.settings) {
    return migrateV2ToV3(value);
  }
  return migrateLegacyState(value);
}

// V2 -> V3: los ejercicios ganan rango de repeticiones y la capa de readiness
// pasa a estar apagada. Rutinas, historial y ajustes se conservan intactos.
export function migrateV2ToV3(previous) {
  const routines = (Array.isArray(previous.routines) ? previous.routines : []).map(normalizeRoutine);
  const history = (Array.isArray(previous.history) ? previous.history : [])
    .map(normalizeHistorySession)
    .filter(Boolean);
  const fallback = createDefaultState();
  const settings = {
    restSeconds: clampInteger(previous.settings?.restSeconds, 10, 600, 90),
    selectedRoutineId: previous.settings?.selectedRoutineId || "",
    // La capa de readiness arranca apagada aunque antes hubiera un score guardado:
    // se activa a propósito, nunca por herencia.
    readinessEnabled: false
  };

  const finalRoutines = routines.length ? routines : fallback.routines;
  if (!finalRoutines.some((routine) => routine.id === settings.selectedRoutineId)) {
    settings.selectedRoutineId = getSuggestedRoutineId({ routines: finalRoutines, history });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    routines: finalRoutines,
    activeSession: previous.activeSession
      ? normalizeActiveSession(previous.activeSession, settings.restSeconds)
      : null,
    history,
    readiness: normalizeStoredReadiness(previous.readiness),
    healthDays: [],
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
    readinessEnabled: false
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
    healthDays: [],
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
  const readinessBand = state.settings?.readinessEnabled ? readinessBandForToday(state.readiness) : null;

  const exercises = routine.exercises.map((exercise) => {
    const previousExercise = findSessionExercise(previousSession, exercise);
    const progression = getExerciseProgression(state.history, exercise, { readinessBand });

    return {
      id: idFactory(),
      templateExerciseId: exercise.id,
      name: exercise.name,
      measure: exercise.measure,
      progression,
      sets: Array.from({ length: exercise.setCount }, (_, setIndex) => {
        const previousSet = previousExercise?.sets?.[setIndex];
        const previousWeight = cleanWeight(previousSet?.weight);
        const previousReps = toPositiveInteger(previousSet?.reps);
        return {
          targetMin: exercise.targetMin,
          targetMax: exercise.targetMax,
          target: exercise.targetMax,
          weight: exercise.measure === "reps"
            ? progression.suggestedWeight || previousWeight || cleanWeight(exercise.defaultWeight)
            : "",
          previousWeight,
          previousReps,
          reps: progression.suggestedReps,
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
      readiness: state.settings?.readinessEnabled ? readinessSnapshot(state.readiness) : null,
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

// ─── Progresión ──────────────────────────────────────────────────────────────

export function defaultIncrement(exercise) {
  if (exercise?.measure === "seconds") return 5;
  const name = normalizeName(exercise?.name);
  // Movimientos de tren inferior y máquinas grandes admiten el salto de disco;
  // el tren superior progresa en incrementos más pequeños.
  return /prensa|sentadilla|squat|hip thrust|femoral|gemelo|peso muerto|leg press/.test(name) ? 2.5 : 1.25;
}

export function getSessionVolume(session) {
  let volume = 0;
  for (const exercise of session?.exercises || []) {
    if (exercise.measure === "seconds") continue;
    for (const set of exercise.sets || []) {
      if (!set.done) continue;
      const weight = Number(set.weight);
      const reps = toPositiveInteger(set.reps);
      if (Number.isFinite(weight) && weight > 0 && reps) volume += weight * reps;
    }
  }
  return Math.round(volume);
}

/**
 * Decide qué hacer con la carga del próximo ejercicio a partir del historial.
 * Devuelve datos, no texto de interfaz: la app decide cómo redactarlo.
 */
export function getExerciseProgression(history, exercise, options = {}) {
  const template = normalizeTemplateExercise(exercise);
  const key = template.id;
  const style = template.style;
  const sessionsToIncrease = EXERCISE_STYLES[style].sessionsToIncrease;
  const sessions = sessionsForExercise(history, template);
  const measure = template.measure;
  const latest = sessions.at(-1) || null;
  const latestWeight = latest ? cleanWeight(heaviestCompletedWeight(latest)) : "";
  const currentWeight = latestWeight || cleanWeight(template.defaultWeight);

  const base = {
    exerciseKey: key,
    style,
    sessionsToIncrease,
    repRange: { min: template.targetMin, max: template.targetMax },
    measure,
    currentWeight,
    suggestedWeight: currentWeight,
    suggestedReps: template.targetMin,
    action: "hold",
    reason: "sin-historial",
    sessionsAtTop: 0,
    sessionsBelowMin: 0,
    stale: false,
    blockedByReadiness: false
  };

  if (!sessions.length) return base;

  const outcomes = sessions.map((entry) => sessionOutcome(entry, template));
  const sessionsAtTop = trailingCount(outcomes, (outcome) => outcome === "top");
  const sessionsBelowMin = trailingCount(outcomes, (outcome) => outcome === "below");
  const lastReps = latest ? bestCompletedReps(latest, measure) : null;

  base.sessionsAtTop = sessionsAtTop;
  base.sessionsBelowMin = sessionsBelowMin;
  base.suggestedReps = clampInteger(
    lastReps ? Math.min(lastReps + 1, template.targetMax) : template.targetMin,
    template.targetMin,
    template.targetMax,
    template.targetMin
  );
  base.stale = isStale(sessions, template);

  if (sessionsBelowMin >= SESSIONS_BELOW_TO_DELOAD) {
    base.action = "deload";
    base.reason = "por-debajo-del-rango";
    base.suggestedReps = template.targetMin;
    if (measure === "reps") {
      base.suggestedWeight = roundToLoadableWeight(Number(currentWeight) * (1 - DELOAD_RATIO));
    }
    return base;
  }

  if (sessionsAtTop >= sessionsToIncrease) {
    if (options.readinessBand === "red") {
      base.action = "hold";
      base.reason = "readiness-rojo";
      base.blockedByReadiness = true;
      base.suggestedReps = template.targetMax;
      return base;
    }
    base.action = "increase";
    base.reason = style === "tricon" ? "sesiones-completadas" : "rango-completado";
    // En volumen se vuelve al mínimo del rango; en TRICON las reps no cambian.
    base.suggestedReps = template.targetMin;
    base.suggestedWeight = measure === "reps"
      ? increasedWeight(currentWeight, template)
      : currentWeight;
    if (measure === "seconds") {
      base.repRange = {
        min: template.targetMin + template.increment,
        max: template.targetMax + template.increment
      };
      base.suggestedReps = base.repRange.min;
    }
    return base;
  }

  base.action = "hold";
  if (style === "tricon") {
    base.reason = sessionsAtTop > 0 ? "faltan-sesiones-al-tope" : "completa-las-nueve";
  } else {
    base.reason = sessionsAtTop > 0 ? "faltan-sesiones-al-tope" : "progresando-en-repeticiones";
  }
  base.sessionsRemaining = Math.max(0, sessionsToIncrease - sessionsAtTop);
  return base;
}

function increasedWeight(currentWeight, template) {
  const current = Number(currentWeight);
  if (!Number.isFinite(current) || current <= 0) return currentWeight;
  // Nunca más de un 5 % de golpe, por muy grande que sea el incremento nominal.
  const step = Math.min(template.increment, current * MAX_INCREASE_RATIO);
  return roundToLoadableWeight(current + Math.max(step, 0));
}

function sessionsForExercise(history, template) {
  return [...(history || [])]
    .sort((a, b) => sessionTime(a) - sessionTime(b))
    .map((session) => {
      const exercise = (session.exercises || []).find((item) =>
        item.templateExerciseId === template.id || normalizeName(item.name) === normalizeName(template.name)
      );
      return exercise ? { session, exercise } : null;
    })
    .filter(Boolean)
    .filter(({ exercise }) => (exercise.sets || []).some((set) => set.done));
}

/**
 * "top"     todas las series completadas llegaron al tope del rango
 * "below"   alguna serie completada se quedó por debajo del mínimo
 * "inside"  dentro del rango, o repeticiones desconocidas
 */
function sessionOutcome({ exercise }, template) {
  const done = (exercise.sets || []).filter((set) => set.done);
  if (!done.length) return "inside";

  const values = done.map((set) => repsForSet(set, exercise.measure || template.measure));
  // El historial migrado desde V2 no registró repeticiones: no se puede afirmar
  // que se completara el rango, así que no cuenta para subir peso.
  if (values.some((value) => value === null)) return "inside";
  if (done.length < template.setCount) return "inside";

  if (values.every((value) => value >= template.targetMax)) return "top";
  if (values.some((value) => value < template.targetMin)) return "below";
  return "inside";
}

function repsForSet(set, measure) {
  const reps = toPositiveInteger(set.reps);
  if (reps) return reps;
  if (measure === "seconds") return toPositiveInteger(set.target) || null;
  return null;
}

function bestCompletedReps(entry, measure) {
  const values = (entry.exercise.sets || [])
    .filter((set) => set.done)
    .map((set) => repsForSet(set, measure))
    .filter((value) => value !== null);
  return values.length ? Math.min(...values) : null;
}

function heaviestCompletedWeight(entry) {
  const values = (entry.exercise.sets || [])
    .filter((set) => set.done)
    .map((set) => Number(set.weight))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : "";
}

function trailingCount(outcomes, predicate) {
  let count = 0;
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    if (!predicate(outcomes[index])) break;
    count += 1;
  }
  return count;
}

function isStale(sessions, template) {
  const recent = sessions.slice(-STALE_SESSIONS);
  if (recent.length < STALE_SESSIONS) return false;
  const signatures = recent.map((entry) => {
    const weight = heaviestCompletedWeight(entry);
    const reps = bestCompletedReps(entry, template.measure);
    return `${weight}|${reps}`;
  });
  return signatures.every((signature) => signature === signatures[0]);
}

// ─── Consultas ───────────────────────────────────────────────────────────────

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
          ? Number(repsForSet(set, "seconds"))
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
            target: toPositiveInteger(set.reps) || Number(set.target) || 0,
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
      .map((set) => exercise.measure === "seconds" ? Number(repsForSet(set, "seconds")) : Number(set.weight))
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

export function getWeeklyVolume(history, weeks = 12) {
  const buckets = new Map();
  for (const session of history || []) {
    const time = sessionTime(session);
    if (!time) continue;
    const key = weekKey(new Date(time));
    const bucket = buckets.get(key) || { week: key, volume: 0, sessions: 0, sets: 0 };
    bucket.volume += getSessionVolume(session);
    bucket.sessions += 1;
    bucket.sets += getSessionTotals(session).done;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.week.localeCompare(b.week)).slice(-weeks);
}

// ─── Readiness (la capa es opcional: sin datos, todo devuelve "sin calcular") ──

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
  const band = bandForScore(score);
  const recommendation = band === "green"
    ? "Sesión prevista"
    : band === "amber"
      ? "Ajusta carga si lo necesitas"
      : "Prioriza una sesión suave";

  return { ...readiness, score, band, recommendation };
}

/**
 * Frontera entre el motor de readiness y el estado guardado. Recibe el
 * resultado de `computeDailyReadiness` y conserva el check-in del mismo día.
 */
export function normalizeReadinessPayload(payload, previous = emptyReadiness()) {
  if (!payload || typeof payload !== "object") {
    throw new Error("El resultado de readiness no es válido.");
  }

  const availableMetrics = clampInteger(payload.availableMetrics ?? payload.metrics, 0, 8, 0);
  const numericScore = Number(payload.objectiveScore ?? payload.score);
  const objectiveScore = availableMetrics >= 2 && Number.isFinite(numericScore)
    ? clampInteger(numericScore, 0, 100, 0)
    : null;
  const date = isDateKey(payload.date) ? payload.date : todayKey();
  const sameDay = previous?.date === date;

  return applyReadinessAdjustments({
    date,
    objectiveScore,
    availableMetrics,
    confidence: payload.confidence
      || (availableMetrics >= 4 ? "alta" : availableMetrics >= 3 ? "media" : "insuficiente"),
    factors: Array.isArray(payload.factors)
      ? payload.factors.slice(0, 3).map((factor) => String(factor).slice(0, 120))
      : [],
    energy: sameDay ? previous.energy || null : null,
    soreness: sameDay ? previous.soreness || null : null,
    updatedAt: new Date().toISOString()
  });
}

export function bandForScore(score) {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= READINESS_BANDS.green) return "green";
  if (score >= READINESS_BANDS.amber) return "amber";
  return "red";
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

function readinessBandForToday(readiness) {
  if (!readiness?.date || readiness.date !== todayKey()) return null;
  return Number.isFinite(readiness.score) ? readiness.band : null;
}

// ─── Plantillas ──────────────────────────────────────────────────────────────

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

export function defaultRangeSpan(measure) {
  return measure === "seconds" ? 15 : 2;
}

/**
 * Por definición, un ejercicio de repeticiones configurado a 9 es TRICON.
 * Queda guardado como campo propio y editable: la regla decide el valor inicial,
 * no lo ata para siempre a ese número.
 */
export function defaultStyle(exercise) {
  if (exercise?.measure === "seconds") return "volumen";
  const reps = Number(exercise?.targetMin ?? exercise?.target);
  return reps === TRICON_REPS ? "tricon" : "volumen";
}

export function styleOf(exercise) {
  return EXERCISE_STYLES[exercise?.style] ? exercise.style : defaultStyle(exercise);
}

/** El rango de un ejercicio de volumen: 10-12, o [objetivo-2, objetivo] si ya iba más alto. */
export function defaultVolumeRange(target, measure) {
  const span = defaultRangeSpan(measure);
  const numeric = Number(target);
  if (!Number.isFinite(numeric)) return { min: EXERCISE_STYLES.volumen.repsMin, max: EXERCISE_STYLES.volumen.repsMax };
  // Los ejercicios por tiempo progresan hacia arriba desde donde estén: bajarle
  // el objetivo a una plancha de 60 s para dejar hueco de rango sería absurdo.
  if (measure === "seconds") return { min: numeric, max: numeric + span };
  return numeric >= EXERCISE_STYLES.volumen.repsMax
    ? { min: numeric - span, max: numeric }
    : { min: numeric, max: numeric + span };
}

function templateExercise(id, name, setCount, target, measure = "reps") {
  const style = defaultStyle({ measure, targetMin: target });
  const range = style === "tricon"
    ? { min: target, max: target }
    : defaultVolumeRange(target, measure);
  const draft = {
    id,
    name,
    setCount,
    style,
    targetMin: range.min,
    targetMax: range.max,
    measure,
    defaultWeight: ""
  };
  return { ...draft, increment: defaultIncrement(draft) };
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
  const parsed = parseTarget(exercise.targetMin ?? exercise.target ?? legacyTarget ?? 10, exercise.measure);
  const measure = parsed.measure;
  const base = clampInteger(parsed.target, 1, 999, 10);
  const style = styleOf({ ...exercise, measure, targetMin: base });

  let targetMin;
  let targetMax;
  if (style === "tricon") {
    // Sin rango: el formato TRICON son nueve repeticiones y no se negocia.
    targetMin = base;
    targetMax = base;
  } else if (exercise.targetMax !== undefined && exercise.targetMin !== undefined) {
    targetMin = base;
    targetMax = clampInteger(exercise.targetMax, base, 999, base + defaultRangeSpan(measure));
  } else {
    const range = defaultVolumeRange(base, measure);
    targetMin = clampInteger(range.min, 1, 999, base);
    targetMax = clampInteger(range.max, targetMin, 999, base);
  }

  const defaultWeight = cleanWeight(
    exercise.defaultWeight ?? legacySets.find((set) => cleanWeight(set.weight))?.weight
  );
  const draft = {
    id: exercise.id || `exercise-${index + 1}-${createId()}`,
    name: String(exercise.name || "Ejercicio sin nombre").trim(),
    setCount: clampInteger(exercise.setCount ?? legacySets.length, 1, 12, 3),
    style,
    targetMin,
    targetMax,
    measure,
    defaultWeight
  };
  const increment = Number(exercise.increment);
  return {
    ...draft,
    increment: Number.isFinite(increment) && increment > 0 ? increment : defaultIncrement(draft)
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
  const parsed = parseTarget(
    sourceSets[0]?.targetMin ?? sourceSets[0]?.target ?? sourceSets[0]?.reps ?? exercise.target ?? 10,
    exercise.measure
  );
  const measure = exercise.measure || parsed.measure;
  const span = defaultRangeSpan(measure);
  return {
    id: exercise.id || `session-exercise-${index + 1}-${createId()}`,
    templateExerciseId: exercise.templateExerciseId || exercise.id || "",
    name: String(exercise.name || "Ejercicio sin nombre").trim(),
    measure,
    progression: exercise.progression || null,
    sets: sourceSets.map((set) => {
      const min = clampInteger(
        set.targetMin ?? set.target ?? set.reps ?? parsed.target,
        1,
        999,
        parsed.target
      );
      const max = clampInteger(set.targetMax ?? set.target ?? min + span, min, 999, min + span);
      return {
        targetMin: min,
        targetMax: max,
        target: max,
        weight: cleanWeight(set.weight),
        previousWeight: cleanWeight(set.previousWeight),
        previousReps: toPositiveInteger(set.previousReps),
        // El historial anterior a V3 no guardó repeticiones reales. Se deja en
        // null a propósito: preferimos no progresar antes que inventar datos.
        reps: toPositiveInteger(set.reps),
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
    availableMetrics: clampInteger(readiness.availableMetrics, 0, 8, 0),
    factors: Array.isArray(readiness.factors) ? readiness.factors.slice(0, 4).map(String) : []
  });
}

export function normalizeHealthDays(value, limit = 120) {
  if (!Array.isArray(value)) return [];
  const byDate = new Map();
  for (const entry of value) {
    if (!entry || !isDateKey(entry.date)) continue;
    byDate.set(entry.date, normalizeHealthDay(entry));
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
}

export const HEALTH_METRICS = [
  "hrv",
  "restingHeartRate",
  "sleepHours",
  "sleepEfficiency",
  "respiratoryRate",
  "wristTemperature",
  "oxygenSaturation"
];

function normalizeHealthDay(entry) {
  const day = { date: entry.date };
  for (const metric of HEALTH_METRICS) {
    day[metric] = toMetricValue(entry[metric]);
  }
  day.sleepSegments = toMetricValue(entry.sleepSegments);
  return day;
}

/**
 * Una métrica ausente es null, nunca cero. `Number(null)` da 0, y un cero
 * entra en la línea base de 60 días como si fuera una medición real: bastan
 * unos pocos para hundir la mediana y descolocar todos los scores siguientes.
 */
function toMetricValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

function toPositiveInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

/**
 * Redondea a 0,25 kg. Media unidad partiría los incrementos de 1,25 kg, que son
 * el par de discos pequeño estándar y el paso mínimo realista del tren superior.
 */
function roundToLoadableWeight(value) {
  return String(Math.round(value * 4) / 4);
}

function sessionTime(session) {
  return Date.parse(session?.completedAt || session?.date || session?.startedAt || 0) || 0;
}

function weekKey(date) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((copy - yearStart) / 86400000 + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
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
