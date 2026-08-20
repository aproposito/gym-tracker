#!/usr/bin/env -S deno run --allow-read
/**
 * Corre el motor de readiness sobre una semilla real y comprueba que sigue
 * comportándose. No valida "aciertos" (no hay verdad de campo), sino las dos
 * propiedades que hacían inservibles a los modelos anteriores: saltos enormes
 * de un día para otro y subcomponentes clavados en 0 o 100.
 *
 *   deno run --allow-read tools/backtest-readiness.mjs semilla.json [desde]
 */
import { computeDailyReadiness, METRIC_SPECS } from "../readiness.js";

export const MAX_MEAN_DAILY_JUMP = 12;
export const MAX_SATURATED_RATIO = 0.02;

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const sd = (values) => {
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
};

export function backtest(days, from) {
  const sample = days.filter((day) => !from || day.date >= from);
  const results = [];
  for (const day of sample) {
    const result = computeDailyReadiness(days, day.date);
    if (result?.objectiveScore !== null && result?.objectiveScore !== undefined) {
      results.push({ date: day.date, ...result });
    }
  }

  const scores = results.map((result) => result.objectiveScore);
  const jumps = [];
  for (let index = 1; index < results.length; index += 1) {
    const gap = (Date.parse(results[index].date) - Date.parse(results[index - 1].date)) / 86400000;
    if (gap === 1) jumps.push(Math.abs(scores[index] - scores[index - 1]));
  }
  const saturated = scores.filter((score) => score <= 0 || score >= 100).length;
  const bands = { green: 0, amber: 0, red: 0 };
  for (const score of scores) {
    bands[score >= 70 ? "green" : score >= 52 ? "amber" : "red"] += 1;
  }

  return {
    evaluated: sample.length,
    scored: results.length,
    mean: mean(scores),
    sd: sd(scores),
    min: Math.min(...scores),
    max: Math.max(...scores),
    meanJump: mean(jumps),
    p90Jump: percentile(jumps, 90),
    saturated,
    saturatedRatio: saturated / scores.length,
    bands,
    results
  };
}

if (import.meta.main) {
  const [path, from = "2025-10-01"] = Deno.args;
  if (!path) {
    console.error("Uso: backtest-readiness.mjs <semilla.json> [desde]");
    Deno.exit(1);
  }
  const raw = JSON.parse(await Deno.readTextFile(path));
  const days = Array.isArray(raw) ? raw : raw.days;
  const report = backtest(days, from);

  console.log(`Días evaluados: ${report.evaluated}   con score: ${report.scored}`);
  console.log(`media ${report.mean.toFixed(1)}  sd ${report.sd.toFixed(1)}  min ${report.min}  max ${report.max}`);
  console.log(`salto medio día a día ${report.meanJump.toFixed(1)} (p90 ${report.p90Jump})`);
  console.log(`saturados en 0 o 100: ${report.saturated} (${(100 * report.saturatedRatio).toFixed(1)} %)`);
  const total = report.scored;
  console.log(
    `bandas: verde ${((100 * report.bands.green) / total).toFixed(0)} %  ` +
    `ámbar ${((100 * report.bands.amber) / total).toFixed(0)} %  ` +
    `rojo ${((100 * report.bands.red) / total).toFixed(0)} %`
  );
  console.log(`métricas del modelo: ${METRIC_SPECS.map((spec) => spec.key).join(", ")}`);

  const problems = [];
  if (report.meanJump > MAX_MEAN_DAILY_JUMP) {
    problems.push(`salto medio ${report.meanJump.toFixed(1)} > ${MAX_MEAN_DAILY_JUMP}`);
  }
  if (report.saturatedRatio > MAX_SATURATED_RATIO) {
    problems.push(`saturación ${(100 * report.saturatedRatio).toFixed(1)} % > ${100 * MAX_SATURATED_RATIO} %`);
  }
  if (problems.length) {
    console.error("\nREGRESIÓN: " + problems.join("; "));
    Deno.exit(1);
  }
  console.log("\nSin regresiones.");
}
