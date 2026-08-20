import test from "node:test";
import assert from "node:assert/strict";

import {
  completeWorkoutSession,
  createDefaultState,
  createWorkoutSession,
  defaultIncrement,
  defaultStyle,
  getExerciseProgression,
  getSessionVolume,
  getWeeklyVolume,
  normalizeState
} from "../domain.js";

/** Ejercicio de volumen: 10-12 repeticiones y luego peso. */
function template(overrides = {}) {
  return {
    id: "press",
    name: "Press máquina",
    setCount: 3,
    style: "volumen",
    targetMin: 10,
    targetMax: 12,
    measure: "reps",
    increment: 1.25,
    defaultWeight: "40",
    ...overrides
  };
}

/** Ejercicio TRICON: nueve repeticiones fijas, sin rango. */
function tricon(overrides = {}) {
  return template({ id: "remo", name: "Remo", style: "tricon", targetMin: 9, targetMax: 9, ...overrides });
}

/** Construye una sesión con las tres series completadas a las repeticiones dadas. */
function session(date, reps, weight = "40", exerciseId = "press") {
  return {
    id: `s-${date}`,
    routineId: "r",
    routineName: "R",
    completedAt: `${date}T10:00:00.000Z`,
    exercises: [{
      templateExerciseId: exerciseId,
      name: "Press máquina",
      measure: "reps",
      sets: [0, 1, 2].map(() => ({
        targetMin: 10,
        targetMax: 12,
        target: 12,
        weight,
        reps,
        done: true
      }))
    }]
  };
}

test("completar el tope del rango una sola vez no sube el peso", () => {
  const progression = getExerciseProgression([session("2026-08-01", 12)], template());

  assert.equal(progression.action, "hold");
  assert.equal(progression.reason, "faltan-sesiones-al-tope");
  assert.equal(progression.sessionsAtTop, 1);
  assert.equal(progression.suggestedWeight, "40");
});

test("dos sesiones consecutivas al tope suben el peso y vuelven al mínimo del rango", () => {
  const history = [session("2026-08-01", 12), session("2026-08-08", 12)];
  const progression = getExerciseProgression(history, template());

  assert.equal(progression.action, "increase");
  assert.equal(progression.reason, "rango-completado");
  assert.equal(progression.sessionsAtTop, 2);
  assert.equal(progression.suggestedWeight, "41.25");
  assert.equal(progression.suggestedReps, 10);
});

test("una sesión floja entre medias reinicia la cuenta", () => {
  const history = [session("2026-08-01", 12), session("2026-08-08", 11), session("2026-08-15", 12)];
  const progression = getExerciseProgression(history, template());

  assert.equal(progression.action, "hold");
  assert.equal(progression.sessionsAtTop, 1);
});

test("el incremento nunca supera el 5 % de la carga", () => {
  // 2,5 kg sobre 20 kg serían un 12,5 %: se recorta al 5 % (1 kg).
  const history = [session("2026-08-01", 12, "20"), session("2026-08-08", 12, "20")];
  const progression = getExerciseProgression(history, template({ increment: 2.5 }));

  assert.equal(progression.action, "increase");
  assert.equal(progression.suggestedWeight, "21");
});

test("dos sesiones por debajo del mínimo proponen descarga del 10 %", () => {
  const history = [session("2026-08-01", 8, "50"), session("2026-08-08", 7, "50")];
  const progression = getExerciseProgression(history, template());

  assert.equal(progression.action, "deload");
  assert.equal(progression.reason, "por-debajo-del-rango");
  assert.equal(progression.suggestedWeight, "45");
  assert.equal(progression.suggestedReps, 10);
});

test("dentro del rango se progresa en repeticiones, no en peso", () => {
  const progression = getExerciseProgression([session("2026-08-01", 10)], template());

  assert.equal(progression.action, "hold");
  assert.equal(progression.reason, "progresando-en-repeticiones");
  assert.equal(progression.suggestedWeight, "40");
  assert.equal(progression.suggestedReps, 11);
});

test("con readiness rojo no se propone subir, pero tampoco se bloquea entrenar", () => {
  const history = [session("2026-08-01", 12), session("2026-08-08", 12)];
  const progression = getExerciseProgression(history, template(), { readinessBand: "red" });

  assert.equal(progression.action, "hold");
  assert.equal(progression.blockedByReadiness, true);
  assert.equal(progression.suggestedWeight, "40");
});

test("el historial sin repeticiones registradas no dispara subidas", () => {
  // Así queda el historial migrado desde V2: series completadas, reps desconocidas.
  const withoutReps = [session("2026-08-01", null), session("2026-08-08", null)];
  const progression = getExerciseProgression(withoutReps, template());

  assert.equal(progression.action, "hold");
  assert.equal(progression.sessionsAtTop, 0);
});

test("una serie sin completar impide contar la sesión como tope", () => {
  const partial = session("2026-08-01", 12);
  partial.exercises[0].sets[2].done = false;
  const progression = getExerciseProgression([partial, session("2026-08-08", 12)], template());

  assert.equal(progression.sessionsAtTop, 1);
  assert.equal(progression.action, "hold");
});

test("detecta estancamiento tras tres sesiones idénticas", () => {
  const history = [session("2026-08-01", 11), session("2026-08-08", 11), session("2026-08-15", 11)];

  assert.equal(getExerciseProgression(history, template()).stale, true);
  assert.equal(getExerciseProgression(history.slice(0, 2), template()).stale, false);
});

test("los incrementos por defecto son mayores en tren inferior", () => {
  assert.equal(defaultIncrement({ name: "Prensa de piernas", measure: "reps" }), 2.5);
  assert.equal(defaultIncrement({ name: "Hip thrust", measure: "reps" }), 2.5);
  assert.equal(defaultIncrement({ name: "Press militar máquina", measure: "reps" }), 1.25);
  assert.equal(defaultIncrement({ name: "Plancha", measure: "seconds" }), 5);
});

test("los ejercicios por tiempo progresan desplazando el rango", () => {
  const plank = template({ id: "plank", name: "Plancha", style: "volumen", measure: "seconds", targetMin: 60, targetMax: 75, increment: 5 });
  const timed = (date) => ({
    id: `s-${date}`,
    routineId: "r",
    completedAt: `${date}T10:00:00.000Z`,
    exercises: [{
      templateExerciseId: "plank",
      name: "Plancha",
      measure: "seconds",
      sets: [0, 1, 2].map(() => ({ targetMin: 60, targetMax: 75, target: 75, weight: "", reps: 75, done: true }))
    }]
  });

  const progression = getExerciseProgression([timed("2026-08-01"), timed("2026-08-08")], plank);
  assert.equal(progression.action, "increase");
  assert.deepEqual(progression.repRange, { min: 65, max: 80 });
});

test("la progresión es idéntica sin readiness y sin datos de salud", () => {
  const history = [session("2026-08-01", 12), session("2026-08-08", 12)];
  const sinCapa = getExerciseProgression(history, template(), {});
  const conCapaVerde = getExerciseProgression(history, template(), { readinessBand: "green" });

  assert.deepEqual(sinCapa, conCapaVerde);
  assert.equal(sinCapa.action, "increase");
});

test("una sesión nueva lleva la sugerencia y el rango a cada serie", () => {
  let state = createDefaultState();
  state.routines[0].exercises[0].defaultWeight = "30";
  state = createWorkoutSession(state, "routine-a");

  // Remo es TRICON por venir configurado a 9 repeticiones.
  const first = state.activeSession.exercises[0];
  assert.equal(first.progression.style, "tricon");
  assert.equal(first.sets[0].targetMin, 9);
  assert.equal(first.sets[0].targetMax, 9);
  assert.equal(first.sets[0].weight, "30");
  assert.equal(first.sets[0].reps, 9);
  assert.equal(first.progression.action, "hold");
});

test("el volumen solo cuenta series completadas con peso y repeticiones", () => {
  const done = session("2026-08-01", 10, "40");
  done.exercises[0].sets[2].done = false;
  assert.equal(getSessionVolume(done), 800);

  const weekly = getWeeklyVolume([done]);
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].volume, 800);
  assert.equal(weekly[0].sets, 2);
});

test("guardar una sesión conserva las repeticiones realizadas", () => {
  let state = normalizeState(createDefaultState());
  state = createWorkoutSession(state, "routine-a");
  const row = state.activeSession.exercises[0];
  for (const set of row.sets) {
    set.weight = "45";
    set.reps = 12;
    set.done = true;
  }
  state = completeWorkoutSession(state);

  assert.equal(state.history[0].exercises[0].sets[0].reps, 12);
  assert.equal(getSessionVolume(state.history[0]), 45 * 12 * 3);
});

// ─── TRICON ──────────────────────────────────────────────────────────────────

/** Sesión TRICON: tres series a nueve repeticiones fijas. */
function sessionTricon(date, reps, weight = "40") {
  return {
    id: `t-${date}`,
    routineId: "r",
    routineName: "R",
    completedAt: `${date}T10:00:00.000Z`,
    exercises: [{
      templateExerciseId: "remo",
      name: "Remo",
      measure: "reps",
      sets: [0, 1, 2].map(() => ({ targetMin: 9, targetMax: 9, target: 9, weight, reps, done: true }))
    }]
  };
}

test("un ejercicio de 9 repeticiones es TRICON por defecto", () => {
  assert.equal(defaultStyle({ measure: "reps", targetMin: 9 }), "tricon");
  assert.equal(defaultStyle({ measure: "reps", targetMin: 10 }), "volumen");
  assert.equal(defaultStyle({ measure: "reps", targetMin: 12 }), "volumen");
  // Por tiempo nunca es TRICON: la plancha progresa en segundos.
  assert.equal(defaultStyle({ measure: "seconds", targetMin: 9 }), "volumen");
});

test("TRICON no tiene rango: el mínimo y el máximo son nueve", () => {
  const [routine] = normalizeState({
    schemaVersion: 2,
    routines: [{ id: "r", name: "R", exercises: [{ id: "remo", name: "Remo", setCount: 3, target: 9, measure: "reps" }] }],
    settings: { restSeconds: 90, selectedRoutineId: "r" }
  }).routines;

  assert.equal(routine.exercises[0].style, "tricon");
  assert.equal(routine.exercises[0].targetMin, 9);
  assert.equal(routine.exercises[0].targetMax, 9);
});

test("TRICON nunca sugiere subir repeticiones", () => {
  const progression = getExerciseProgression([sessionTricon("2026-08-01", 9)], tricon());

  assert.equal(progression.suggestedReps, 9);
  assert.deepEqual(progression.repRange, { min: 9, max: 9 });
});

test("TRICON exige tres sesiones completas antes de subir peso", () => {
  const dos = [sessionTricon("2026-08-01", 9), sessionTricon("2026-08-08", 9)];
  const conDos = getExerciseProgression(dos, tricon());
  assert.equal(conDos.action, "hold");
  assert.equal(conDos.sessionsRemaining, 1);

  const tres = [...dos, sessionTricon("2026-08-15", 9)];
  const conTres = getExerciseProgression(tres, tricon());
  assert.equal(conTres.action, "increase");
  assert.equal(conTres.reason, "sesiones-completadas");
  assert.equal(conTres.suggestedWeight, "41.25");
  assert.equal(conTres.suggestedReps, 9);
});

test("TRICON progresa más despacio que volumen con el mismo historial", () => {
  const fechas = ["2026-08-01", "2026-08-08"];
  const volumenSube = getExerciseProgression(fechas.map((d) => session(d, 12)), template());
  const triconEspera = getExerciseProgression(fechas.map((d) => sessionTricon(d, 9)), tricon());

  assert.equal(volumenSube.action, "increase");
  assert.equal(triconEspera.action, "hold");
});

test("no llegar a las nueve en TRICON acaba en descarga", () => {
  const history = [sessionTricon("2026-08-01", 7, "50"), sessionTricon("2026-08-08", 8, "50")];
  const progression = getExerciseProgression(history, tricon());

  assert.equal(progression.action, "deload");
  assert.equal(progression.suggestedWeight, "45");
});
