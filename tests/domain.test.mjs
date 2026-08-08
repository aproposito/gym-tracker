import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_VERSION,
  completeWorkoutSession,
  createDefaultState,
  createWorkoutSession,
  discardWorkoutSession,
  getExerciseProgress,
  getPersonalRecords,
  getSuggestedRoutineId,
  normalizeReadinessPayload,
  normalizeState,
  todayKey,
  updateReadinessCheckin
} from "../domain.js";

function idFactory() {
  let index = 0;
  return () => `id-${++index}`;
}

test("migra V1 sin sustituir rutinas personalizadas ni el historial", () => {
  const legacy = {
    activeRoutineId: "custom-a",
    restSeconds: 75,
    routineTemplateVersion: 1,
    routines: [{
      id: "custom-a",
      name: "Mi rutina",
      exercises: [{
        id: "custom-plank",
        name: "Plancha lateral",
        sets: [
          { reps: "45 seg", weight: "", done: false },
          { reps: "45 seg", weight: "", done: false }
        ]
      }]
    }],
    history: [{
      id: "old-session",
      routineId: "custom-a",
      routineName: "Mi rutina",
      date: "2026-05-04T18:00:00.000Z",
      exercises: [{
        id: "custom-plank",
        name: "Plancha lateral",
        sets: [{ reps: "40 seg", weight: "", done: true }]
      }]
    }]
  };

  const migrated = normalizeState(legacy);

  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.routines.length, 1);
  assert.equal(migrated.routines[0].name, "Mi rutina");
  assert.equal(migrated.routines[0].exercises[0].measure, "seconds");
  assert.equal(migrated.routines[0].exercises[0].target, 45);
  assert.equal(migrated.history.length, 1);
  assert.equal(migrated.history[0].exercises[0].sets[0].target, 40);
  assert.equal(migrated.activeSession, null);
});

test("recupera como borrador el progreso que existía en V1", () => {
  const legacy = {
    activeRoutineId: "routine-a",
    routines: [{
      id: "routine-a",
      name: "Rutina A personalizada",
      exercises: [{
        id: "press",
        name: "Press",
        sets: [
          { reps: "8", weight: "30", done: true },
          { reps: "8", weight: "30", done: false }
        ]
      }]
    }],
    history: []
  };

  const migrated = normalizeState(legacy);

  assert.ok(migrated.activeSession);
  assert.equal(migrated.activeSession.routineName, "Rutina A personalizada");
  assert.equal(migrated.activeSession.exercises[0].sets[0].done, true);
  assert.equal(migrated.routines[0].exercises[0].setCount, 2);
});

test("una sesión es independiente de la plantilla y desechar restaura el estado persistente", () => {
  const original = createDefaultState();
  original.routines[0].exercises[0].defaultWeight = "35";
  const snapshot = structuredClone(original);
  let working = createWorkoutSession(original, "routine-a", {
    now: "2026-08-08T08:00:00.000Z",
    idFactory: idFactory()
  });

  working.activeSession.exercises[0].sets[0].weight = "42.5";
  working.activeSession.exercises[0].sets[0].done = true;

  assert.deepEqual(working.routines, snapshot.routines);
  assert.deepEqual(original, snapshot);

  const discarded = discardWorkoutSession(working);
  assert.equal(discarded.activeSession, null);
  assert.deepEqual(discarded.routines, snapshot.routines);
  assert.deepEqual(discarded.history, snapshot.history);
  assert.deepEqual(discarded.readiness, snapshot.readiness);
  assert.equal(discarded.settings.selectedRoutineId, "routine-a");
});

test("guardar conserva solo el resultado de sesión y sugiere la rutina siguiente", () => {
  let state = createDefaultState();
  state = createWorkoutSession(state, "routine-a", {
    now: "2026-08-08T08:00:00.000Z",
    idFactory: idFactory()
  });
  state.activeSession.exercises[0].sets[0].weight = "40";
  state.activeSession.exercises[0].sets[0].done = true;
  state = completeWorkoutSession(state, { completedAt: "2026-08-08T08:45:00.000Z" });

  assert.equal(state.activeSession, null);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].durationSeconds, 2700);
  assert.equal(state.routines[0].exercises[0].defaultWeight, "");
  assert.equal(getSuggestedRoutineId(state), "routine-b");
  assert.equal(state.settings.selectedRoutineId, "routine-b");
});

test("la sesión siguiente recupera pesos de la última sesión equivalente", () => {
  let state = createDefaultState();
  state = createWorkoutSession(state, "routine-a", { idFactory: idFactory() });
  state.activeSession.exercises[0].sets[0].weight = "42.5";
  state.activeSession.exercises[0].sets[0].done = true;
  state = completeWorkoutSession(state);
  state = createWorkoutSession(state, "routine-a", { idFactory: idFactory() });

  const firstSet = state.activeSession.exercises[0].sets[0];
  assert.equal(firstSet.previousWeight, "42.5");
  assert.equal(firstSet.weight, "42.5");
  assert.equal(firstSet.done, false);
});

test("solo las series completadas producen récords y puntos de progreso", () => {
  let state = createDefaultState();
  state = createWorkoutSession(state, "routine-a", { idFactory: idFactory() });
  const row = state.activeSession.exercises[0];
  row.sets[0].weight = "45";
  row.sets[0].done = true;
  row.sets[1].weight = "100";
  row.sets[1].done = false;
  const plank = state.activeSession.exercises.find((exercise) => exercise.templateExerciseId === "a-plank");
  plank.sets[0].done = true;
  state = completeWorkoutSession(state);

  const records = getPersonalRecords(state.history);
  assert.equal(records.get("a-row").value, 45);
  assert.equal(records.get("a-plank").value, 60);
  assert.equal(records.get("a-plank").measure, "seconds");
  assert.deepEqual(getExerciseProgress(state.history, "a-row").map((point) => point.value), [45]);
});

test("readiness exige dos métricas y aplica las correcciones locales", () => {
  const insufficient = normalizeReadinessPayload({
    date: todayKey(),
    objectiveScore: 88,
    availableMetrics: 1,
    factors: ["Solo sueño"]
  });
  assert.equal(insufficient.score, null);
  assert.equal(insufficient.band, "unknown");

  let readiness = normalizeReadinessPayload({
    date: todayKey(),
    objectiveScore: 72,
    availableMetrics: 3,
    factors: ["HRV estable", "Pulso estable", "Sueño 7 h"]
  });
  assert.equal(readiness.score, 72);
  assert.equal(readiness.band, "green");

  readiness = updateReadinessCheckin(readiness, "energy", "low");
  readiness = updateReadinessCheckin(readiness, "soreness", "high");
  assert.equal(readiness.score, 47);
  assert.equal(readiness.band, "amber");
});
