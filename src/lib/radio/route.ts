// Парсер файла траектории движения станции B (приёмопередатчик).
// Формат (JSON / .rt):
// {
//   "route": { "points": [ { "altitude": 204, "lat": 50.487, "lon": 36.838, "speed": 120 }, ... ] },
//   "tripodHeight": 4
// }
// lat/lon — WGS-84 (градусы).
// altitude — высота над уровнем моря (м), используется в расчёте как абсолютная
//            высота антенны (AMSL). Допускаются алиасы: alt, height, elevation.
// tripodHeight — дополнительная высота антенны над точкой altitude (м), суммируется.
// speed — опционально (м/с).

export interface TrajectoryPoint {
  lat: number;
  lon: number;
  /** Высота над уровнем моря (м), из файла */
  altitudeM: number;
  speedMs: number | null;
}

export interface Trajectory {
  points: TrajectoryPoint[];
  tripodHeightM: number | null;
  fileName: string;
}

export interface ParseTrajectoryResult {
  trajectory: Trajectory | null;
  warnings: string[];
  error: string | null;
}

const MAX_POINTS = 1000;

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function asFiniteNumber(v: unknown): number | null {
  if (finite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Ошибки синтаксиса JSON с привязкой к позиции (Фаза 3.3): вместо
 *  молчаливого «не является корректным JSON» — строка/колонка и фрагмент. */
function describeJsonSyntaxError(err: unknown, text: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /position (\d+)/i.exec(msg);
  if (!m) return msg;
  const pos = Math.min(Number(m[1]), text.length);
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - (before.lastIndexOf("\n") + 1);
  const fragStart = Math.max(0, pos - 20);
  const frag = text
    .slice(fragStart, Math.min(text.length, pos + 20))
    .replace(/\n/g, "↵");
  return `${msg} — строка ${line}, колонка ${col + 1}: …${frag}…`;
}

/** Попытка починить JSON без внешней обёртки { ... }. */
function tryParseJson(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  let firstErr: unknown = null;
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    firstErr = e;
  }
  try {
    return JSON.parse(`{${trimmed}}`);
  } catch {
    /* не удалось — сообщаем про оригинальный документ */
  }
  throw new Error(describeJsonSyntaxError(firstErr, trimmed));
}

function readAltitude(p: Record<string, unknown>): number | null {
  for (const key of ["altitude", "alt", "height", "elevation", "h", "alt_msl"]) {
    if (key in p) {
      const n = asFiniteNumber(p[key]);
      if (n !== null) return n;
    }
  }
  return null;
}

/** Разбор и валидация JSON-файла траектории. */
export function parseTrajectoryFile(
  fileName: string,
  text: string
): ParseTrajectoryResult {
  const warnings: string[] = [];

  let data: unknown;
  try {
    data = tryParseJson(text);
  } catch (e) {
    return {
      trajectory: null,
      warnings,
      error: `Файл «${fileName}» не является корректным JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  if (typeof data !== "object" || data === null) {
    return {
      trajectory: null,
      warnings,
      error: `Ожидается объект с полем «route»`,
    };
  }

  const root = data as Record<string, unknown>;
  const route = root.route;
  if (typeof route !== "object" || route === null || !("points" in route)) {
    return {
      trajectory: null,
      warnings,
      error: `В файле «${fileName}» нет массива route.points`,
    };
  }

  const rawPoints = (route as Record<string, unknown>).points;
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) {
    return {
      trajectory: null,
      warnings,
      error: `Массив route.points в «${fileName}» пуст`,
    };
  }

  if (rawPoints.length > MAX_POINTS) {
    warnings.push(
      `Точек в файле: ${rawPoints.length} — расчёт для первых ${MAX_POINTS}`
    );
  }

  const points: TrajectoryPoint[] = [];
  let skipped = 0;
  let minAlt = Infinity;
  let maxAlt = -Infinity;

  for (const raw of rawPoints.slice(0, MAX_POINTS)) {
    if (typeof raw !== "object" || raw === null) {
      skipped++;
      continue;
    }
    const p = raw as Record<string, unknown>;
    const lat = asFiniteNumber(p.lat);
    const lon = asFiniteNumber(p.lon ?? p.lng ?? p.longitude);
    const altitude = readAltitude(p);
    if (lat === null || lat < -90 || lat > 90) {
      skipped++;
      continue;
    }
    if (lon === null || lon < -180 || lon > 180) {
      skipped++;
      continue;
    }
    if (altitude === null) {
      skipped++;
      warnings.push(
        `Точка lat=${lat}, lon=${lon}: нет altitude (высота над уровнем моря) — пропущена`
      );
      continue;
    }
    points.push({
      lat,
      lon,
      altitudeM: altitude,
      speedMs: asFiniteNumber(p.speed) ?? asFiniteNumber(p.velocity),
    });
    minAlt = Math.min(minAlt, altitude);
    maxAlt = Math.max(maxAlt, altitude);
  }

  if (points.length === 0) {
    return {
      trajectory: null,
      warnings,
      error: `В «${fileName}» нет точек с корректными lat/lon/altitude (высота над ур. моря)`,
    };
  }
  if (skipped > 0) {
    warnings.push(`Пропущено точек с некорректными данными: ${skipped}`);
  }

  warnings.push(
    `Высоты из файла (над ур. моря): ${minAlt.toFixed(0)}…${maxAlt.toFixed(0)} м — используются в расчёте`
  );

  let tripodHeightM: number | null = null;
  const trip =
    asFiniteNumber(root.tripodHeight) ??
    asFiniteNumber(root.tripod) ??
    asFiniteNumber(root.antennaHeight);
  if (trip !== null && trip >= 0) {
    tripodHeightM = trip;
  } else {
    warnings.push(
      "tripodHeight не задан — к высоте AMSL из точек ничего не добавляется"
    );
  }

  return {
    trajectory: { points, tripodHeightM, fileName },
    warnings,
    error: null,
  };
}
