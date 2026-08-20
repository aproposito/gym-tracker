import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAbsoluteGuards,
  computeDailyReadiness,
  mergeHealthDays,
  metricSubscore,
  parseHealthPayload,
  robustBaseline,
  sanitizeHealthDay
} from "../readiness.js";
import { normalizeHealthDays } from "../domain.js";

/** Genera N días de línea base estable a los que añadir un día de prueba. */
function baselineDays(count = 40, overrides = {}) {
  const days = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
    days.push({
      date,
      hrv: 32 + (index % 5) - 2,
      restingHeartRate: 56 + (index % 3) - 1,
      sleepHours: 6.8 + ((index % 4) - 1.5) * 0.2,
      respiratoryRate: 15 + (index % 3) * 0.2,
      wristTemperature: 36.2 + (index % 3) * 0.05,
      oxygenSaturation: 96 + (index % 2),
      sleepSegments: 12,
      ...overrides
    });
  }
  return days;
}

function withFinalDay(fields, count = 40) {
  const days = baselineDays(count);
  const date = new Date(Date.UTC(2026, 0, 1 + count)).toISOString().slice(0, 10);
  days.push({ date, sleepSegments: 12, ...fields });
  return { days, date };
}

test("la escala robusta no se dispara con una señal muy estable", () => {
  // MAD cero: sin suelo, cualquier desviación mínima daría z infinita.
  const baseline = robustBaseline(Array.from({ length: 30 }, () => 60));

  assert.equal(baseline.center, 60);
  assert.ok(baseline.scale >= 60 * 0.03);
  const sub = metricSubscore(61, baseline);
  assert.ok(sub.score < 100 && sub.score > 0);
});

test("no hay línea base con menos de 21 días", () => {
  assert.equal(robustBaseline(Array.from({ length: 20 }, (_, i) => 30 + i)), null);
  assert.ok(robustBaseline(Array.from({ length: 21 }, (_, i) => 30 + i)));
});

test("ninguna entrada plausible satura en 0 ni en 100", () => {
  const extremos = [
    { hrv: 5, restingHeartRate: 95, sleepHours: 3.5, respiratoryRate: 22, wristTemperature: 38, oxygenSaturation: 88 },
    { hrv: 180, restingHeartRate: 38, sleepHours: 10, respiratoryRate: 11, wristTemperature: 35, oxygenSaturation: 100 }
  ];

  for (const fields of extremos) {
    const { days, date } = withFinalDay(fields);
    const result = computeDailyReadiness(days, date);
    assert.ok(result.objectiveScore > 0, `saturó en 0 con ${JSON.stringify(fields)}`);
    assert.ok(result.objectiveScore < 100, `saturó en 100 con ${JSON.stringify(fields)}`);
  }
});

test("una noche muy corta hunde el score aunque el resto sea normal", () => {
  const { days, date } = withFinalDay({
    hrv: 32,
    restingHeartRate: 56,
    sleepHours: 1.1,
    sleepSegments: 8,
    respiratoryRate: 15,
    wristTemperature: 36.2,
    oxygenSaturation: 96
  });

  const result = computeDailyReadiness(days, date);
  assert.ok(result.objectiveScore < 45, `esperaba <45 y salió ${result.objectiveScore}`);
  assert.ok(result.flags.some((flag) => flag.includes("sueño")));
});

test("un pulso en reposo muy por encima de la base marca el día en rojo", () => {
  const { days, date } = withFinalDay({
    hrv: 32,
    restingHeartRate: 75,
    sleepHours: 7,
    respiratoryRate: 15,
    wristTemperature: 36.2,
    oxygenSaturation: 96
  });

  const result = computeDailyReadiness(days, date);
  assert.ok(result.objectiveScore <= 35);
  assert.ok(result.flags.some((flag) => flag.includes("Pulso")));
});

test("sin HRV ni pulso en reposo no se da score", () => {
  // Temperatura y oxígeno por sí solos llegaron a puntuar 90 en el histórico.
  const { days, date } = withFinalDay({ wristTemperature: 36.1, oxygenSaturation: 97 });

  const result = computeDailyReadiness(days, date);
  assert.equal(result.objectiveScore, null);
  assert.equal(result.confidence, "insuficiente");
});

test("una sola señal tampoco basta", () => {
  const { days, date } = withFinalDay({ restingHeartRate: 56 });
  assert.equal(computeDailyReadiness(days, date).objectiveScore, null);
});

test("un sueño imposible se trata como ausente, no como catástrofe", () => {
  // Reloj en la mesilla: 0,2 h sin fases registradas.
  const noWear = sanitizeHealthDay({ date: "2026-02-10", sleepHours: 0.2, sleepSegments: 1 });
  assert.equal(noWear.sleepHours, null);
  assert.equal(noWear.sleepUnreliable, true);

  // Noche real y mala: corta pero con fases registradas.
  const realBadNight = sanitizeHealthDay({ date: "2026-02-10", sleepHours: 2.4, sleepSegments: 9 });
  assert.equal(realBadNight.sleepHours, 2.4);
  assert.ok(!realBadNight.sleepUnreliable);
});

test("un día sin datos de sueño no arrastra el score por debajo del rojo", () => {
  const { days, date } = withFinalDay({
    hrv: 32,
    restingHeartRate: 56,
    sleepHours: 0.2,
    sleepSegments: 1,
    respiratoryRate: 15
  });

  const result = computeDailyReadiness(days, date);
  assert.ok(result.objectiveScore >= 52, `esperaba >=52 y salió ${result.objectiveScore}`);
  assert.ok(result.flags.includes("Sueño sin registrar"));
});

test("los topes absolutos solo bajan, nunca suben", () => {
  const baselines = { restingHeartRate: { center: 56, scale: 3 } };
  const alto = applyAbsoluteGuards(85, { sleepHours: 8, restingHeartRate: 55 }, baselines);
  assert.equal(alto.score, 85);

  const bajo = applyAbsoluteGuards(85, { sleepHours: 4, restingHeartRate: 55 }, baselines);
  assert.ok(bajo.score < 85);
});

test("no se puntúa un día que no está en los datos", () => {
  const days = baselineDays(30);
  assert.equal(computeDailyReadiness(days, "2030-01-01"), null);
});

test("fusionar días nuevos pisa los antiguos sin duplicar fechas", () => {
  const existing = [{ date: "2026-08-01", hrv: 30 }, { date: "2026-08-02", hrv: 31 }];
  // Apple recalcula el sueño y sincroniza tarde: lo recibido después manda.
  const merged = mergeHealthDays(existing, [{ date: "2026-08-02", hrv: 35, sleepHours: 7 }]);

  assert.equal(merged.length, 2);
  assert.equal(merged[1].hrv, 35);
  assert.equal(merged[1].sleepHours, 7);
});

test("la fusión conserva como mucho el límite de días", () => {
  const many = Array.from({ length: 200 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
    hrv: 30
  }));
  const merged = mergeHealthDays([], many, 120);

  assert.equal(merged.length, 120);
  assert.equal(merged.at(-1).date, many.at(-1).date);
});

test("el parser acepta los formatos del Atajo, del ZIP y de Health Auto Export", () => {
  const desdeAtajo = parseHealthPayload('{"days":[{"date":"2026-08-19","hrv":28,"restingHeartRate":55}]}');
  assert.equal(desdeAtajo.length, 1);
  assert.equal(desdeAtajo[0].hrv, 28);

  const array = parseHealthPayload([{ date: "2026-08-19", hrv_sdnn_ms: 28, resting_heart_rate_bpm: 55 }]);
  assert.equal(array[0].restingHeartRate, 55);

  const unicoDia = parseHealthPayload({ fecha: "2026-08-19", sdnn: 30, rhr: 54 });
  assert.equal(unicoDia[0].date, "2026-08-19");
  assert.equal(unicoDia[0].hrv, 30);
});

test("la saturación de oxígeno se normaliza a porcentaje", () => {
  // Apple la entrega como fracción; el resto del motor la usa en %.
  assert.equal(parseHealthPayload([{ date: "2026-08-19", spo2: 0.97 }])[0].oxygenSaturation, 97);
  assert.equal(parseHealthPayload([{ date: "2026-08-19", spo2: 97 }])[0].oxygenSaturation, 97);
});

test("el parser rechaza lo que no tiene ninguna fecha utilizable", () => {
  assert.throws(() => parseHealthPayload('{"days":[{"hrv":30}]}'), /fecha válida/);
  assert.throws(() => parseHealthPayload("[]"), /fecha válida/);
});

test("los días llegan ordenados y sin campos vacíos", () => {
  const days = parseHealthPayload([
    { date: "2026-08-19", hrv: 30, restingHeartRate: "" },
    { date: "2026-08-17", hrv: 28 }
  ]);

  assert.deepEqual(days.map((day) => day.date), ["2026-08-17", "2026-08-19"]);
  assert.ok(!("restingHeartRate" in days[1]));
});

test("una métrica ausente se guarda como null, nunca como cero", () => {
  // Number(null) es 0, y un cero entra en la línea base como medición real.
  const [day] = normalizeHealthDays([{
    date: "2026-08-18",
    hrv: null,
    restingHeartRate: 61,
    sleepHours: undefined,
    respiratoryRate: ""
  }]);

  assert.equal(day.hrv, null);
  assert.equal(day.sleepHours, null);
  assert.equal(day.respiratoryRate, null);
  assert.equal(day.restingHeartRate, 61);
});

test("los ceros colados en la línea base no hunden el score", () => {
  const days = baselineDays(40);
  // Cinco días sin medir HRV, guardados por error como cero.
  for (const index of [3, 8, 14, 21, 29]) days[index].hrv = null;
  const normalized = normalizeHealthDays(days);
  const date = new Date(Date.UTC(2026, 0, 41)).toISOString().slice(0, 10);
  normalized.push({ date, hrv: 32, restingHeartRate: 56, sleepHours: 7, respiratoryRate: 15, sleepSegments: 12 });

  const result = computeDailyReadiness(normalized, date);
  assert.ok(result.objectiveScore > 55, `un HRV normal debería puntuar bien y salió ${result.objectiveScore}`);
});
