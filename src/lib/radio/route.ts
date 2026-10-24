// Парсер файла траектории движения ПРМ. Формат (JSON):
// {
//   "route": { "points": [ { "altitude": 204, "lat": 50.487, "lon": 36.838, "speed": 120 }, ... ] },
//   "tripodHeight": 4
// }
// lat/lon — WGS-84 (градусы), altitude — высота приёмника над уровнем моря (м),
// speed — опционально (м/с), tripodHeight — высота штатива/установки антенны (м).

export interface TrajectoryPoint {
  lat: number; // WGS-84, градусы
  lon: number; // WGS-84, градусы
  altitudeM: number; // высота над уровнем моря, м
  speedMs: number | null; // опционально
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

/** Разбор и валидация JSON-файла траектории. */
export function parseTrajectoryFile(
  fileName: string,
  text: string
): ParseTrajectoryResult {
  const warnings: string[] = [];

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      trajectory: null,
      warnings,
      error: `Файл «${fileName}» не является корректным JSON`,
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
      `Точек в файле: ${rawPoints.length} — расчёт выполняется для первых ${MAX_POINTS}`
    );
  }

  const points: TrajectoryPoint[] = [];
  let skipped = 0;

  for (const raw of rawPoints.slice(0, MAX_POINTS)) {
    if (typeof raw !== "object" || raw === null) {
      skipped++;
      continue;
    }
    const p = raw as Record<string, unknown>;
    const lat = p.lat;
    const lon = p.lon;
    const altitude = p.altitude;
    if (!finite(lat) || lat < -90 || lat > 90) {
      skipped++;
      continue;
    }
    if (!finite(lon) || lon < -180 || lon > 180) {
      skipped++;
      continue;
    }
    if (!finite(altitude)) {
      skipped++;
      continue;
    }
    points.push({
      lat,
      lon,
      altitudeM: altitude,
      speedMs: finite(p.speed) ? p.speed : null,
    });
  }

  if (points.length === 0) {
    return {
      trajectory: null,
      warnings,
      error: `В «${fileName}» нет ни одной точки с корректными lat/lon/altitude`,
    };
  }
  if (skipped > 0) {
    warnings.push(`Пропущено точек с некорректными данными: ${skipped}`);
  }

  let tripodHeightM: number | null = null;
  if (finite(root.tripodHeight) && root.tripodHeight >= 0) {
    tripodHeightM = root.tripodHeight;
  } else {
    warnings.push("tripodHeight не задан — используется высота антенны ПРМ из формы");
  }

  return {
    trajectory: { points, tripodHeightM, fileName },
    warnings,
    error: null,
  };
}
