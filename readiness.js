/**
 * Motor de readiness. Funciones puras, sin DOM y sin estado global.
 *
 * El score compara cada señal con TU propia línea base de 60 días mediante una
 * z robusta (mediana + MAD), no con constantes de manual. Esa es la diferencia
 * que importa: sobre el histórico real, las fórmulas de razón simple saturaban
 * en 0 o 100 el 30 % de los días y saltaban 17 puntos de un día para otro.
 *
 * Deliberadamente NO hay factor de carga de entrenamiento. En los datos de este
 * usuario la correlación entre carga semanal y HRV es +0,26 y con el pulso en
 * reposo −0,20: entrenar duro mejora sus marcadores. Un castigo por carga
 * restaría puntos justo en las semanas de mejor forma.
 */

export const BASELINE_WINDOW_DAYS = 60;
export const MIN_BASELINE_SAMPLES = 21;
export const Z_CLAMP = 2.2;
export const NEUTRAL_SCORE = 68;
export const Z_SPAN = 13;

/** Suelo de escala: evita que una señal muy estable dispare z enormes. */
export const MIN_SCALE_RATIO = 0.03;

export const METRIC_SPECS = [
  { key: "hrv", label: "HRV", weight: 0.28, invert: false, smoothDays: 3, core: true },
  { key: "restingHeartRate", label: "Pulso en reposo", weight: 0.26, invert: true, smoothDays: 2, core: true },
  { key: "sleepHours", label: "Sueño", weight: 0.24, invert: false, smoothDays: 1 },
  { key: "respiratoryRate", label: "Respiración", weight: 0.12, invert: true, smoothDays: 1 },
  { key: "wristTemperature", label: "Temperatura", weight: 0.06, invert: true, smoothDays: 1 },
  { key: "oxygenSaturation", label: "Oxígeno", weight: 0.04, invert: false, smoothDays: 1 }
];

/** Por debajo de esto y sin fases de sueño registradas, el reloj no se llevó. */
export const IMPLAUSIBLE_SLEEP_HOURS = 3;
export const MIN_SLEEP_SEGMENTS = 4;

export function median(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const half = clean.length >> 1;
  return clean.length % 2 ? clean[half] : (clean[half - 1] + clean[half]) / 2;
}

/**
 * Mediana y escala robusta (MAD x 1.4826). El suelo del 3 % corrige el fallo que
 * tenía el modelo de readiness-complejo: con una variable muy concentrada, la
 * escala se acercaba a cero y cualquier desviación mínima daba z al tope.
 */
export function robustBaseline(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < MIN_BASELINE_SAMPLES) return null;
  const center = median(clean);
  const deviation = median(clean.map((value) => Math.abs(value - center))) || 0;
  const scale = Math.max(deviation * 1.4826, Math.abs(center) * MIN_SCALE_RATIO, 1e-9);
  return { center, scale, samples: clean.length };
}

export function clamp(value, low = 0, high = 100) {
  return Math.min(high, Math.max(low, value));
}

/** null, undefined y "" NO son cero. Convertirlos a 0 activaba topes por error. */
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Convierte una desviación respecto a la línea base en un subscore 0-100. */
export function metricSubscore(value, baseline, { invert = false } = {}) {
  if (!Number.isFinite(value) || !baseline) return null;
  let z = (value - baseline.center) / baseline.scale;
  if (invert) z = -z;
  return { score: clamp(NEUTRAL_SCORE + Z_SPAN * clamp(z, -Z_CLAMP, Z_CLAMP)), z };
}

/**
 * Descarta valores que son ausencia de medición disfrazada de dato extremo.
 * Una "noche" de 0,2 h es el reloj en la mesilla, no insomnio, y tratarla como
 * catástrofe ensucia tanto el score del día como la línea base de los 60
 * siguientes.
 */
export function sanitizeHealthDay(day) {
  if (!day) return null;
  const clean = { ...day };
  const hours = toFiniteNumber(clean.sleepHours);
  const segments = toFiniteNumber(clean.sleepSegments);
  if (hours !== null && hours < IMPLAUSIBLE_SLEEP_HOURS) {
    const staged = segments !== null && segments >= MIN_SLEEP_SEGMENTS;
    if (!staged) {
      clean.sleepHours = null;
      clean.sleepUnreliable = true;
    }
  }
  return clean;
}

function windowValues(days, index, key, span = BASELINE_WINDOW_DAYS) {
  const values = [];
  for (let step = 1; step <= span && index - step >= 0; step += 1) {
    const value = toFiniteNumber(days[index - step]?.[key]);
    if (value !== null) values.push(value);
  }
  return values;
}

/**
 * Media de los últimos `smoothDays` días para domar el ruido. El día objetivo
 * tiene que traer dato propio: si no, el suavizado tomaría prestada la medición
 * de anteayer y presentaría como de hoy un valor que nadie midió hoy.
 */
function smoothedValue(days, index, key, smoothDays) {
  const today = toFiniteNumber(days[index]?.[key]);
  if (today === null) return null;

  const values = [today];
  for (let step = 1; step < smoothDays && index - step >= 0; step += 1) {
    const value = toFiniteNumber(days[index - step]?.[key]);
    if (value !== null) values.push(value);
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Topes absolutos. La z contesta "¿hoy es raro para mí?", que no es lo mismo que
 * "¿hoy es objetivamente malo?". Sin estos límites una noche de 1,1 h puntuaba
 * 52 porque el resto de señales la compensaban.
 */
export function applyAbsoluteGuards(score, day, baselines) {
  let capped = score;
  const flags = [];
  const sleep = toFiniteNumber(day?.sleepHours);
  const restingHeartRate = toFiniteNumber(day?.restingHeartRate);
  const restingBaseline = baselines?.restingHeartRate;

  if (Number.isFinite(sleep)) {
    if (sleep < 5) {
      capped = Math.min(capped, 40 + 8 * Math.max(0, sleep - 2));
      flags.push(`Solo ${formatHours(sleep)} de sueño`);
    } else if (sleep < 6.5) {
      capped = Math.min(capped, 72);
    }
  }

  if (Number.isFinite(restingHeartRate) && restingBaseline) {
    const excess = restingHeartRate - restingBaseline.center;
    if (excess > 12) {
      capped = Math.min(capped, 35);
      flags.push(`Pulso ${Math.round(excess)} ppm sobre tu base`);
    } else if (excess > 7) {
      capped = Math.min(capped, 52);
      flags.push("Pulso en reposo elevado");
    }
  }

  return { score: capped, flags };
}

/**
 * Calcula el readiness objetivo de un día.
 *
 * @param {Array} healthDays Días ordenados por fecha ascendente.
 * @param {string} date Fecha objetivo (YYYY-MM-DD).
 * @returns {object|null} Payload compatible con el estado, o null si no hay día.
 */
export function computeDailyReadiness(healthDays, date) {
  const days = (healthDays || [])
    .map(sanitizeHealthDay)
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  const index = days.findIndex((day) => day.date === date);
  if (index < 0) return null;

  const day = days[index];
  const parts = [];
  const baselines = {};
  let hasCoreSignal = false;

  for (const spec of METRIC_SPECS) {
    const baseline = robustBaseline(windowValues(days, index, spec.key));
    if (baseline) baselines[spec.key] = baseline;
    const value = smoothedValue(days, index, spec.key, spec.smoothDays);
    if (!Number.isFinite(value) || !baseline) continue;

    const sub = metricSubscore(value, baseline, { invert: spec.invert });
    if (!sub) continue;
    if (spec.core) hasCoreSignal = true;
    parts.push({ ...spec, value, baseline, score: sub.score, z: sub.z });
  }

  // Sin HRV ni pulso en reposo no hay señal autónoma que interpretar: temperatura
  // y oxígeno por sí solos llegaron a dar un 90 en el backtest.
  if (!hasCoreSignal || parts.length < 2) {
    return {
      date,
      objectiveScore: null,
      availableMetrics: parts.length,
      confidence: "insuficiente",
      factors: [],
      flags: day.sleepUnreliable ? ["Sueño sin registrar"] : []
    };
  }

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const weighted = parts.reduce((sum, part) => sum + part.weight * part.score, 0) / totalWeight;
  const guarded = applyAbsoluteGuards(weighted, day, baselines);

  return {
    date,
    objectiveScore: Math.round(clamp(guarded.score)),
    availableMetrics: parts.length,
    confidence: confidenceFor(parts),
    factors: describeFactors(parts, guarded.flags),
    flags: guarded.flags.concat(day.sleepUnreliable ? ["Sueño sin registrar"] : [])
  };
}

function confidenceFor(parts) {
  const coreCount = parts.filter((part) => part.core).length;
  if (coreCount === 2 && parts.length >= 4) return "alta";
  if (parts.length >= 3) return "media";
  return "baja";
}

function describeFactors(parts, flags) {
  const sorted = [...parts].sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const factors = sorted
    .filter((part) => Math.abs(part.z) >= 0.5)
    .slice(0, 3)
    .map((part) => `${part.label}: ${describeDirection(part)}`);
  if (!factors.length) return ["Todo dentro de tu rango habitual"];
  return flags.length ? [flags[0], ...factors].slice(0, 3) : factors;
}

function describeDirection(part) {
  const better = part.z > 0;
  const magnitude = Math.abs(part.z) >= 1.5 ? "bastante" : "algo";
  const value = part.key === "sleepHours"
    ? formatHours(part.value)
    : `${Math.round(part.value * 10) / 10}`;
  return `${value} · ${magnitude} ${better ? "mejor" : "peor"} que tu media`;
}

function formatHours(hours) {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes ? `${whole} h ${minutes} min` : `${whole} h`;
}

/**
 * Fusiona días recibidos del Atajo con los ya guardados, sin duplicar fechas.
 * Los datos nuevos ganan: Apple recalcula el sueño y sincroniza con retraso.
 */
export function mergeHealthDays(existing, incoming, limit = 120) {
  const byDate = new Map();
  for (const day of existing || []) {
    if (day?.date) byDate.set(day.date, day);
  }
  for (const day of incoming || []) {
    if (!day?.date) continue;
    byDate.set(day.date, { ...byDate.get(day.date), ...day });
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-limit);
}

const FIELD_ALIASES = {
  date: ["date", "fecha", "day"],
  hrv: ["hrv", "hrv_sdnn_ms", "hrvSdnn", "heartRateVariability", "sdnn"],
  restingHeartRate: ["restingHeartRate", "resting_heart_rate_bpm", "rhr", "restingHR"],
  sleepHours: ["sleepHours", "sleep_hours", "sleep", "asleepHours"],
  sleepEfficiency: ["sleepEfficiency", "sleep_efficiency"],
  sleepSegments: ["sleepSegments", "sleep_segments", "segments"],
  respiratoryRate: ["respiratoryRate", "respiratory_rate", "respiration"],
  wristTemperature: ["wristTemperature", "wrist_temperature_c", "wristTemp"],
  oxygenSaturation: ["oxygenSaturation", "oxygen_saturation_pct", "spo2"]
};

/**
 * Acepta lo que produzca el Atajo, el importador del ZIP o Health Auto Export:
 * un día suelto, un array, o un objeto con `days`. Tolera los nombres de campo
 * de cada origen para que cambiar de transporte no obligue a tocar el parser.
 */
/**
 * El Atajo formatea la fecha con un patrón personalizado en iOS ("Custom" +
 * "yyyy-MM-dd") que no se puede verificar sin el dispositivo. Si el resultado
 * no es exactamente ISO, se intenta interpretar igualmente; si ni así se
 * puede, se asume "hoy" en vez de descartar el día — el uso normal es
 * ejecutar el Atajo y pegar en el momento, así que "hoy" es la suposición
 * correcta con más frecuencia que un rechazo silencioso.
 */
function normalizeDateValue(value) {
  const text = String(value ?? "").trim().slice(0, 32);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/**
 * Atajos construye el JSON concatenando texto, así que una métrica sin muestras
 * ese día no deja `null`: deja un hueco. El resultado real observado en el
 * iPhone es `{"hrv":36,"respiratoryRate":,"wristTemperature":}`, que no es JSON
 * válido y tumbaba el pegado entero por una señal ausente.
 *
 * Se reparan los huecos antes de parsear. No se intenta arreglar cualquier JSON
 * roto: solo este patrón concreto, que es consecuencia previsible de cómo
 * Atajos arma el texto.
 */
export function repairShortcutJson(text) {
  return String(text)
    // "clave": ,   ó   "clave": }   ->   "clave": null
    .replace(/:\s*(?=[,}\]])/g, ":null")
    // Coma sobrante antes de cerrar, por si falta el último valor.
    .replace(/,\s*(?=[}\]])/g, "");
}

export function parseHealthPayload(raw) {
  let source;
  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw);
    } catch {
      source = JSON.parse(repairShortcutJson(raw));
    }
  } else {
    source = raw;
  }
  const list = Array.isArray(source)
    ? source
    : Array.isArray(source?.days)
      ? source.days
      : source && typeof source === "object"
        ? [source]
        : [];

  const days = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const day = {};
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (field === "date") {
        // Basta con que la clave exista: una fecha vacía es la que el Atajo no
        // supo rellenar, y ahí "hoy" es mejor suposición que tirar el día.
        const key = aliases.find((alias) => alias in entry);
        if (key !== undefined) day.date = normalizeDateValue(entry[key]);
        continue;
      }
      const key = aliases.find((alias) => entry[alias] !== undefined && entry[alias] !== null && entry[alias] !== "");
      if (key === undefined) continue;
      day[field] = Number(entry[key]);
    }
    // Si no hay ninguna clave de fecha reconocible, se descarta: eso sí es un
    // payload ajeno al esquema, no un formato de fecha imperfecto.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date || "")) continue;
    // Apple entrega la saturación como fracción; el resto del motor la usa en %.
    if (Number.isFinite(day.oxygenSaturation) && day.oxygenSaturation <= 1) {
      day.oxygenSaturation *= 100;
    }
    for (const [field, value] of Object.entries(day)) {
      if (field !== "date" && !Number.isFinite(value)) delete day[field];
    }
    days.push(day);
  }

  if (!days.length) throw new Error("No se han encontrado días con fecha válida.");
  return days.sort((a, b) => a.date.localeCompare(b.date));
}
