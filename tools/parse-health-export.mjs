#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Convierte la exportación oficial de Apple Salud en una semilla de métricas
 * diarias para Gym Tracker.
 *
 * El motor de readiness necesita 60 días de línea base. Sin semilla, el score no
 * empieza a funcionar hasta dos meses después de activar la capa. Esto se
 * ejecuta una vez (o cuando quieras recalibrar) y el día a día lo cubre el Atajo.
 *
 *   deno run --allow-read --allow-write --allow-run \
 *     tools/parse-health-export.mjs ~/Downloads/exportación.zip semilla.json
 *
 * El XML interno ronda los 2 GB, así que se lee en streaming y solo se retienen
 * los agregados por día. Nada se envía a ninguna parte.
 */

const TYPES = {
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: "hrv",
  HKQuantityTypeIdentifierRestingHeartRate: "restingHeartRate",
  HKCategoryTypeIdentifierSleepAnalysis: "sleep",
  HKQuantityTypeIdentifierRespiratoryRate: "respiratoryRate",
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: "wristTemperature",
  HKQuantityTypeIdentifierOxygenSaturation: "oxygenSaturation"
};

const NIGHT_END_HOUR = 9;

function attr(line, name) {
  const match = line.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : null;
}

function parseLocal(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, sign, offsetHours, offsetMinutes] = match;
  const utc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const offset = (sign === "-" ? -1 : 1) * ((+offsetHours) * 60 + (+offsetMinutes)) * 60000;
  return {
    day: `${year}-${month}-${day}`,
    minutes: +hour * 60 + +minute,
    epoch: utc - offset
  };
}

function addDay(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

/** Una noche se atribuye al día en que te despiertas. */
function nightDay(end) {
  return end.minutes < 12 * 60 ? end.day : addDay(end.day, 1);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value, decimals = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function createAccumulator() {
  const days = new Map();
  const bucket = (key) => {
    if (!days.has(key)) {
      days.set(key, {
        date: key,
        hrv: [],
        restingHeartRate: null,
        asleepSeconds: 0,
        awakeSeconds: 0,
        sleepSegments: 0,
        respiratoryRate: [],
        oxygenSaturation: [],
        wristTemperature: null
      });
    }
    return days.get(key);
  };

  return {
    days,
    addLine(line) {
      const type = attr(line, "type");
      const metric = TYPES[type];
      if (!metric) return;
      const start = parseLocal(attr(line, "startDate"));
      const end = parseLocal(attr(line, "endDate"));
      if (!start || !end) return;
      const raw = attr(line, "value");
      const value = Number(raw);

      if (metric === "sleep") {
        const target = bucket(nightDay(end));
        const seconds = Math.max(0, (end.epoch - start.epoch) / 1000);
        if (raw === "HKCategoryValueSleepAnalysisAwake") {
          target.awakeSeconds += seconds;
        } else if (String(raw).startsWith("HKCategoryValueSleepAnalysisAsleep")) {
          target.asleepSeconds += seconds;
          target.sleepSegments += 1;
        }
        return;
      }

      if (!Number.isFinite(value)) return;

      switch (metric) {
        case "hrv":
          bucket(start.day).hrv.push(value);
          break;
        case "restingHeartRate":
          bucket(start.day).restingHeartRate = value;
          break;
        // Respiración y oxígeno solo son comparables medidos en reposo nocturno.
        case "respiratoryRate":
          if (start.minutes < NIGHT_END_HOUR * 60) bucket(start.day).respiratoryRate.push(value);
          break;
        case "oxygenSaturation":
          if (start.minutes < NIGHT_END_HOUR * 60) {
            bucket(start.day).oxygenSaturation.push(value <= 1 ? value * 100 : value);
          }
          break;
        case "wristTemperature":
          bucket(nightDay(end)).wristTemperature = value;
          break;
      }
    },
    toDays() {
      return [...days.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((entry) => {
          const total = entry.asleepSeconds + entry.awakeSeconds;
          return {
            date: entry.date,
            hrv: round(mean(entry.hrv)),
            restingHeartRate: entry.restingHeartRate,
            sleepHours: entry.asleepSeconds ? round(entry.asleepSeconds / 3600) : null,
            sleepEfficiency: total ? round((100 * entry.asleepSeconds) / total, 1) : null,
            sleepSegments: entry.sleepSegments || null,
            respiratoryRate: round(mean(entry.respiratoryRate)),
            wristTemperature: round(entry.wristTemperature),
            oxygenSaturation: round(mean(entry.oxygenSaturation), 1)
          };
        })
        .filter((day) => Object.entries(day).some(([key, value]) => key !== "date" && value !== null));
    }
  };
}

async function* streamLines(source) {
  const decoder = new TextDecoder();
  let carry = "";
  for await (const chunk of source) {
    carry += decoder.decode(chunk, { stream: true });
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) yield line;
  }
  if (carry) yield carry;
}

async function openSource(path) {
  if (path.endsWith(".zip")) {
    // unzip -p descomprime a stdout sin escribir los 2 GB en disco.
    const command = new Deno.Command("unzip", {
      args: ["-p", path, "apple_health_export/*.xml"],
      stdout: "piped",
      stderr: "null"
    });
    return command.spawn().stdout;
  }
  const file = await Deno.open(path, { read: true });
  return file.readable;
}

if (import.meta.main) {
  const [input, output = "health-seed.json"] = Deno.args;
  if (!input) {
    console.error("Uso: parse-health-export.mjs <export.zip|export.xml> [salida.json]");
    Deno.exit(1);
  }

  const accumulator = createAccumulator();
  let lines = 0;
  for await (const line of streamLines(await openSource(input))) {
    lines += 1;
    if (line.includes("<Record ")) accumulator.addLine(line);
  }

  const days = accumulator.toDays();
  await Deno.writeTextFile(output, JSON.stringify({ days }));
  const last = days.at(-1);
  console.log(`Líneas leídas: ${lines.toLocaleString("es-ES")}`);
  console.log(`Días con datos: ${days.length} (${days[0]?.date} → ${last?.date})`);
  console.log(`Escrito en ${output}`);
}
