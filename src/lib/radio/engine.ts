// Движок расчёта: геометрия трассы, профиль рельефа по HGT,
// бюджет линии связи и скан азимутов для круговой диаграммы зоны связи.

import {
  LatLon,
  normalizeAzDeg,
  vincentyDirect,
  vincentyInverse,
} from "./geodesy";
import { clamp } from "./format";
import { HgtTileMap, sampleHeight, tileKeyAt } from "./hgt";
import { syntheticElevation } from "./synthetic";
import {
  curvatureDropM,
  diffractionLoss,
  DiffractionResult,
  fresnelRadiusM,
  fsplDb,
  wavelengthM,
} from "./pathloss";
import {
  gridConvergenceDeg,
  Helmert3,
  Sk42Point,
  sk42ToWgs84,
  zoneForLon,
} from "./sk42";

export interface RadioParams {
  fMHz: number;
  pTxDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  txFeederDb: number;
  rxFeederDb: number;
  extraLossDb: number;
  txAntHM: number; // высота антенны ПРД над рельефом, м
  rxAntHM: number; // высота антенны ПРМ над рельефом, м
  sensitivityDbm: number;
  fadeMarginDb: number;
  kFactor: number;
  /** Если true — при отсутствии HGT использовать синтетический рельеф (демо). */
  useSynthetic?: boolean;
  helm: Helmert3;
}

export interface PathGeom {
  txSk42: Sk42Point;
  rxSk42: Sk42Point;
  txWgs: LatLon;
  rxWgs: LatLon;
  distanceM: number;
  fwdAzDeg: number; // истинный азимут ПРД → ПРМ
  revAzDeg: number;
  gridAzDeg: number; // дирекционный угол (СК-42)
  zone: number;
}

export function pathGeometry(
  tx: Sk42Point,
  rx: Sk42Point,
  helm: Helmert3
): PathGeom {
  const txWgs = sk42ToWgs84(tx.B, tx.L, helm);
  const rxWgs = sk42ToWgs84(rx.B, rx.L, helm);
  const inv = vincentyInverse(txWgs, rxWgs);
  const zone = zoneForLon(tx.L);
  const gamma = gridConvergenceDeg(tx.B, tx.L, zone);
  return {
    txSk42: tx,
    rxSk42: rx,
    txWgs,
    rxWgs,
    distanceM: inv.distance,
    fwdAzDeg: normalizeAzDeg(inv.fwdAz * (180 / Math.PI)),
    revAzDeg: normalizeAzDeg(inv.revAz * (180 / Math.PI)),
    gridAzDeg: normalizeAzDeg(inv.fwdAz * (180 / Math.PI) - gamma),
    zone,
  };
}

export interface RawProfilePoint {
  d: number;
  h: number; // высота рельефа, м (BSL)
  hc: number; // с учётом кривизны Земли (k)
  valid: boolean;
}

export interface RawProfile {
  pts: RawProfilePoint[];
  distanceM: number;
  txTerrainM: number;
  rxTerrainM: number;
  gapCount: number;
  usedTiles: Set<string>;
  missingTiles: Set<string>;
}

/**
 * Профиль рельефа вдоль геодезической линии (азимут постоянен в начальной
 * точке; шаг — геодезическая). Высоты берутся из HGT (WGS-84).
 * Отсутствие высоты в конечных точках — ошибка; внутри профиля значения
 * переносятся с предыдущего отсчёта (учитывается в gapCount).
 */
export function buildProfileRaw(
  tiles: HgtTileMap,
  txWgs: LatLon,
  fwdAzRad: number,
  distanceM: number,
  nPoints: number,
  kFactor: number,
  useSynthetic = false
): RawProfile {
  const n = Math.max(2, Math.round(nPoints));
  const pts: RawProfilePoint[] = [];
  const usedTiles = new Set<string>();
  const missingTiles = new Set<string>();
  let gapCount = 0;
  let lastValid = 0;

  for (let i = 0; i <= n; i++) {
    const d = (distanceM * i) / n;
    const p = vincentyDirect(txWgs, fwdAzRad, d);
    const key = tileKeyAt(p.lat, p.lon);
    let h = sampleHeight(tiles, p.lat, p.lon);
    if (h === null && useSynthetic) {
      h = syntheticElevation(p.lat, p.lon);
    }
    if (h === null) {
      missingTiles.add(key);
      if (i === 0 || i === n) {
        throw new Error(
          `Нет данных HGT в ${i === 0 ? "точке ПРД" : "точке ПРМ"} — нужен файл ${key}.hgt (или включите синтетический рельеф)`
        );
      }
      gapCount++;
      pts.push({ d, h: lastValid, hc: 0, valid: false });
    } else {
      lastValid = h;
      if (sampleHeight(tiles, p.lat, p.lon) === null && useSynthetic) {
        // синтетика — не считаем тайл «использованным»
      } else {
        usedTiles.add(key);
      }
      pts.push({ d, h, hc: 0, valid: true });
    }
  }

  const D = distanceM;
  for (const p of pts) {
    p.hc = p.h - curvatureDropM(p.d, D - p.d, kFactor);
  }

  return {
    pts,
    distanceM,
    txTerrainM: pts[0].h,
    rxTerrainM: pts[n].h,
    gapCount,
    usedTiles,
    missingTiles,
  };
}

export interface ProfilePoint extends RawProfilePoint {
  los: number; // высота линии визирования, м
  r1: number; // радиус первой зоны Френеля, м
  v: number; // параметр препятствия
}

/** Расчёт линии визирования, зоны Френеля и параметров v по готовому профилю. */
export function deriveProfile(
  raw: RawProfile,
  h1AbsM: number,
  h2AbsM: number,
  fMHz: number
): ProfilePoint[] {
  const D = raw.distanceM;
  return raw.pts.map((p) => {
    const los = h1AbsM + ((h2AbsM - h1AbsM) * p.d) / D;
    const r1 = p.d > 0 && p.d < D ? fresnelRadiusM(p.d, D - p.d, fMHz) : 0;
    // v = (hc − los)·√2/r1; r1² = λ·d1·d2/(d1+d2), поэтому √(2(d1+d2)/(λd1d2)) = √2/r1
    const v = r1 > 0 ? ((p.hc - los) * Math.SQRT2) / r1 : -Infinity;
    return { ...p, los, r1, v };
  });
}

export interface LinkResult {
  geom: PathGeom;
  distanceM: number;
  fMHz: number;
  lambdaM: number;
  txTerrainM: number;
  rxTerrainM: number;
  h1AbsM: number;
  h2AbsM: number;
  eirpDbm: number;
  fspl: number;
  diff: DiffractionResult;
  prxDbm: number;
  marginDb: number;
  ok: boolean;
  f1MidM: number;
  minClearance: number; // min (просвет/ r1) по трассе; >0.6 — зона Френеля чиста
  pts: ProfilePoint[];
  gapCount: number;
  gapRatio: number;
  obstacles: Array<{ dM: number; hM: number; v: number }>;
}

/** Полный расчёт трассы ПРД → ПРМ. */
export function evaluateLink(
  tiles: HgtTileMap,
  geom: PathGeom,
  params: RadioParams
): LinkResult {
  const D = geom.distanceM;
  if (D < 1) {
    throw new Error("Точки ПРД и ПРМ совпадают");
  }
  if (D > 1000_000) {
    throw new Error("Дальность более 1000 км — модель неприменима");
  }
  const step = Math.max(25, D / 400);
  const nPts = clamp(Math.ceil(D / step), 30, 500);

  const raw = buildProfileRaw(
    tiles,
    geom.txWgs,
    geom.fwdAzDeg * (Math.PI / 180),
    D,
    nPts,
    params.kFactor,
    !!params.useSynthetic
  );
  const h1 = raw.txTerrainM + params.txAntHM;
  const h2 = raw.rxTerrainM + params.rxAntHM;
  const pts = deriveProfile(raw, h1, h2, params.fMHz);

  const diff = diffractionLoss(
    pts.map((p) => ({ d: p.d, hc: p.hc })),
    h1,
    h2,
    params.fMHz
  );
  const fspl = fsplDb(D, params.fMHz);
  const eirp = params.pTxDbm - params.txFeederDb + params.txGainDbi;
  const prx =
    params.pTxDbm -
    params.txFeederDb +
    params.txGainDbi -
    fspl -
    diff.loss -
    params.extraLossDb +
    params.rxGainDbi -
    params.rxFeederDb;
  const margin = prx - params.sensitivityDbm;

  let minClearance = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    if (p.r1 <= 0) continue;
    const c = (p.los - p.hc) / p.r1;
    if (c < minClearance) minClearance = c;
  }
  if (!Number.isFinite(minClearance)) minClearance = Infinity;

  const obstacles = pts
    .filter((p) => p.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 5)
    .map((p) => ({ dM: p.d, hM: p.h, v: p.v }));

  return {
    geom,
    distanceM: D,
    fMHz: params.fMHz,
    lambdaM: wavelengthM(params.fMHz),
    txTerrainM: raw.txTerrainM,
    rxTerrainM: raw.rxTerrainM,
    h1AbsM: h1,
    h2AbsM: h2,
    eirpDbm: eirp,
    fspl,
    diff,
    prxDbm: prx,
    marginDb: margin,
    ok: margin >= 0,
    f1MidM: fresnelRadiusM(D / 2, D / 2, params.fMHz),
    minClearance,
    pts,
    gapCount: raw.gapCount,
    gapRatio: raw.gapCount / Math.max(1, raw.pts.length - 2),
    obstacles,
  };
}

export interface PointEval {
  margin: number;
  dataOk: boolean;
}

/** Оценка бюджета до произвольной точки (азимут, дальность) — для зоны покрытия. */
export function evaluatePoint(
  tiles: HgtTileMap,
  txWgs: LatLon,
  azRad: number,
  distanceM: number,
  params: RadioParams
): PointEval {
  const nPts = clamp(Math.round(distanceM / 900), 18, 120);
  const raw = buildProfileRaw(
    tiles,
    txWgs,
    azRad,
    distanceM,
    nPts,
    params.kFactor,
    !!params.useSynthetic
  );
  if (raw.gapCount > nPts * 0.25) {
    return { margin: 0, dataOk: false };
  }
  const h1 = raw.txTerrainM + params.txAntHM;
  const h2 = raw.rxTerrainM + params.rxAntHM;
  const pts = deriveProfile(raw, h1, h2, params.fMHz);
  const diff = diffractionLoss(
    pts.map((p) => ({ d: p.d, hc: p.hc })),
    h1,
    h2,
    params.fMHz
  );
  const fspl = fsplDb(distanceM, params.fMHz);
  const prx =
    params.pTxDbm -
    params.txFeederDb +
    params.txGainDbi -
    fspl -
    diff.loss -
    params.extraLossDb +
    params.rxGainDbi -
    params.rxFeederDb;
  return { margin: prx - params.sensitivityDbm, dataOk: true };
}

/** Оценка точки с перехватом отсутствия HGT (конец луча в пустом тайле). */
function safeEvaluatePoint(
  tiles: HgtTileMap,
  txWgs: LatLon,
  azRad: number,
  distanceM: number,
  params: RadioParams
): PointEval {
  try {
    return evaluatePoint(tiles, txWgs, azRad, distanceM, params);
  } catch {
    return { margin: 0, dataOk: false };
  }
}

export interface CoverageRay {
  azDeg: number;
  /** Дальность с запасом ≥ fadeMargin (уверенный сигнал), км */
  km: number;
  /** Дальность с запасом ≥ 0 (неустойчивый / на грани), км */
  kmWeak: number;
  status: "ok" | "data" | "limit";
}

export interface CoverageResult {
  rays: CoverageRay[];
  analysisKm: number;
  areaKm2: number;
  bestAz: number;
  bestKm: number;
  worstAz: number;
  worstKm: number;
  limitHits: number; // азимутов, упёршихся в радиус анализа
  dataHits: number; // азимутов, ограниченных отсутствием HGT
}

const COVERAGE_LADDER_KM = [
  0.5, 0.8, 1.2, 1.8, 2.7, 4, 6, 9, 13, 19, 28, 42, 62, 92, 135, 200, 290, 420,
];

/**
 * Круговая диаграмма: для каждого азимута — максимальная дальность,
 * на которой запас на входе ПРМ не меньше требуемого.
 */
export function scanCoverage(
  tiles: HgtTileMap,
  txWgs: LatLon,
  params: RadioParams,
  analysisKm: number
): CoverageResult {
  const ladder = COVERAGE_LADDER_KM.filter((km) => km <= analysisKm);
  if (ladder.length === 0 || ladder[ladder.length - 1] < analysisKm) {
    ladder.push(analysisKm);
  }
  const rays: CoverageRay[] = [];

  const refine = (
    azRad: number,
    lo: number,
    hi: number,
    minMargin: number
  ): number => {
    for (let i = 0; i < 5; i++) {
      const mid = (lo + hi) / 2;
      const res = safeEvaluatePoint(tiles, txWgs, azRad, mid * 1000, params);
      if (res.dataOk && res.margin >= minMargin) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  for (let az = 0; az < 360; az += 5) {
    const azRad = (az * Math.PI) / 180;
    let lastGood = 0; // margin >= fade
    let lastWeak = 0; // margin >= 0
    let status: CoverageRay["status"] = "ok";
    let failGoodKm: number | null = null;
    let failWeakKm: number | null = null;
    let dataFailKm: number | null = null;

    for (const km of ladder) {
      const res = safeEvaluatePoint(tiles, txWgs, azRad, km * 1000, params);
      if (!res.dataOk) {
        status = "data";
        dataFailKm = km;
        break;
      }
      if (res.margin >= params.fadeMarginDb) {
        lastGood = km;
        lastWeak = km;
      } else if (res.margin >= 0) {
        lastWeak = km;
        if (failGoodKm === null) failGoodKm = km;
      } else {
        if (failGoodKm === null) failGoodKm = km;
        if (failWeakKm === null) failWeakKm = km;
        break;
      }
    }

    let km = lastGood;
    let kmWeak = lastWeak;

    if (failGoodKm !== null && lastGood < failGoodKm) {
      km = refine(azRad, lastGood, failGoodKm, params.fadeMarginDb);
    } else if (status !== "data" && failGoodKm === null && lastGood > 0) {
      // весь ladder зелёный — уточним до analysisKm
      km = lastGood;
    }

    if (failWeakKm !== null && lastWeak < failWeakKm) {
      kmWeak = refine(azRad, lastWeak, failWeakKm, 0);
    } else if (dataFailKm !== null && lastWeak < dataFailKm && lastWeak > 0) {
      kmWeak = refine(azRad, lastWeak, dataFailKm, 0);
    }

    if (status === "data" && lastGood === 0 && lastWeak === 0) {
      km = 0;
      kmWeak = 0;
    }

    if (status === "ok" && dataFailKm === null && failWeakKm === null && lastGood >= analysisKm * 0.98) {
      status = "limit";
      km = analysisKm;
      kmWeak = Math.max(kmWeak, analysisKm);
    } else if (status === "ok" && dataFailKm === null && failGoodKm === null) {
      status = "limit";
      km = analysisKm;
      kmWeak = Math.max(kmWeak, analysisKm);
    }

    kmWeak = Math.max(kmWeak, km);
    rays.push({ azDeg: az, km, kmWeak, status });
  }

  let area = 0;
  let bestAz = 0;
  let bestKm = -1;
  let worstAz = 0;
  let worstKm = Infinity;
  let limitHits = 0;
  let dataHits = 0;
  for (const r of rays) {
    area += (Math.PI * r.km * r.km) / rays.length;
    if (r.km > bestKm) {
      bestKm = r.km;
      bestAz = r.azDeg;
    }
    if (r.km < worstKm) {
      worstKm = r.km;
      worstAz = r.azDeg;
    }
    if (r.status === "limit") limitHits++;
    if (r.status === "data") dataHits++;
  }

  return {
    rays,
    analysisKm,
    areaKm2: area,
    bestAz,
    bestKm,
    worstAz,
    worstKm,
    limitHits,
    dataHits,
  };
}

export interface VerticalPoint {
  heightM: number; // высота антенны ПРМ над рельефом, м
  prxDbm: number;
  marginDb: number;
  ok: boolean;
}

export interface VerticalResult {
  points: VerticalPoint[];
  distanceKm: number;
  azDeg: number;
  thresholdDbm: number; // чувствительность + запас
  minHeightM: number | null; // мин. высота, где связь есть
  terrainM: number; // рельеф в точке анализа
  prxMaxDbm: number;
  prxMinDbm: number;
}

/**
 * Вертикальный анализ: уровень сигнала на входе ПРМ в зависимости от
 * высоты антенны ПРМ над рельефом. Профиль рельефа строится один раз,
 * перебираются только высоты — быстро даже для 100+ точек.
 */
export function verticalAnalysis(
  tiles: HgtTileMap,
  txWgs: LatLon,
  azDeg: number,
  distanceKm: number,
  params: RadioParams,
  maxHM = 50,
  stepHM = 0.5
): VerticalResult {
  const distanceM = distanceKm * 1000;
  if (distanceM < 1) throw new Error("Дальность менее 1 м");
  if (distanceM > 1000_000) throw new Error("Дальность более 1000 км");

  const azRad = (azDeg * Math.PI) / 180;
  const nPts = clamp(Math.round(distanceM / 900), 18, 120);
  const raw = buildProfileRaw(tiles, txWgs, azRad, distanceM, nPts, params.kFactor, !!params.useSynthetic);

  const h1 = raw.txTerrainM + params.txAntHM;
  const thresholdDbm = params.sensitivityDbm + params.fadeMarginDb;
  const eirp = params.pTxDbm - params.txFeederDb + params.txGainDbi;
  const fspl = fsplDb(distanceM, params.fMHz);
  const fixedLoss = fspl + params.extraLossDb + params.rxFeederDb;

  const points: VerticalPoint[] = [];
  let minHeightM: number | null = null;
  let prxMax = -Infinity;
  let prxMin = Infinity;

  for (let h = stepHM; h <= maxHM + 1e-9; h += stepHM) {
    const h2 = raw.rxTerrainM + h;
    const pts = deriveProfile(raw, h1, h2, params.fMHz);
    const diff = diffractionLoss(
      pts.map((p) => ({ d: p.d, hc: p.hc })),
      h1,
      h2,
      params.fMHz
    );
    const prx = eirp - fixedLoss - diff.loss + params.rxGainDbi;
    const margin = prx - params.sensitivityDbm;
    const ok = margin >= params.fadeMarginDb;
    points.push({ heightM: h, prxDbm: prx, marginDb: margin, ok });
    if (ok && minHeightM === null) minHeightM = h;
    if (prx > prxMax) prxMax = prx;
    if (prx < prxMin) prxMin = prx;
  }

  return {
    points,
    distanceKm,
    azDeg,
    thresholdDbm,
    minHeightM,
    terrainM: raw.rxTerrainM,
    prxMaxDbm: prxMax,
    prxMinDbm: prxMin,
  };
}

/** Имена тайлов HGT, необходимых для трассы и зоны анализа. */
export function requiredTileNames(
  txWgs: LatLon | null,
  rxWgs: LatLon | null,
  analysisKm: number | null
): { path: string[]; area: string[] } {
  const pathSet = new Set<string>();
  const areaSet = new Set<string>();

  if (txWgs && rxWgs) {
    const inv = vincentyInverse(txWgs, rxWgs);
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const p = vincentyDirect(txWgs, inv.fwdAz, (inv.distance * i) / steps);
      pathSet.add(tileKeyAt(p.lat, p.lon));
    }
  }

  if (txWgs && analysisKm && analysisKm > 0) {
    const dLat = analysisKm / 111.32;
    const cosLat = Math.cos((txWgs.lat * Math.PI) / 180) || 1e-6;
    const dLon = analysisKm / (111.32 * cosLat);
    const stepDeg = 0.25;
    for (let lat = txWgs.lat - dLat; lat <= txWgs.lat + dLat + 1e-9; lat += stepDeg) {
      for (
        let lon = txWgs.lon - dLon;
        lon <= txWgs.lon + dLon + 1e-9;
        lon += stepDeg
      ) {
        const dLatM = (lat - txWgs.lat) * 111320;
        const dLonM = (lon - txWgs.lon) * 111320 * cosLat;
        if (Math.sqrt(dLatM * dLatM + dLonM * dLonM) <= analysisKm * 1000) {
          areaSet.add(tileKeyAt(lat, lon));
        }
      }
    }
  }

  const sorted = (s: Set<string>) => Array.from(s).sort();
  return {
    path: sorted(pathSet),
    area: sorted(areaSet).filter((k) => !pathSet.has(k)),
  };
}

// --- Траектория движения ПРМ ---

export interface TrajectoryPointResult {
  idx: number;
  lat: number; // WGS-84, градусы (как в файле)
  lon: number;
  altitudeM: number; // высота из файла (уровень моря)
  terrainM: number | null; // рельеф под точкой (если тайл есть)
  aglM: number | null; // высота антенны ПРМ над рельефом
  distanceM: number; // дальность от ПРД
  fwdAzDeg: number; // истинный азимут ПРД → точка
  fspl: number | null;
  diffLossDb: number | null;
  prxDbm: number | null;
  marginDb: number | null;
  ok: boolean;
  status: "ok" | "data" | "error";
  message?: string;
}

export interface TrajectoryResult {
  points: TrajectoryPointResult[];
  tripodHeightM: number | null;
  fMHz: number;
  okCount: number;
  dataCount: number;
  errorCount: number;
  bestIdx: number | null; // максимальный запас
  worstIdx: number | null; // минимальный запас
}

/**
 * Расчёт радиолинии ПРД → ПРМ в каждой точке траектории.
 * Высота ПРМ берётся из файла (абсолютная, над уровнем моря); если рельеф
 * под точкой известен и точка ниже него, антенна поднимается на штатив
 * tripodHeightM над рельефом. Частота — прямого канала (ПРД).
 */
export function evaluateTrajectory(
  tiles: HgtTileMap,
  txWgs: LatLon,
  txSk42: Sk42Point,
  trajectory: {
    points: Array<{ lat: number; lon: number; altitudeM: number }>;
    tripodHeightM: number | null;
  },
  params: RadioParams
): TrajectoryResult {
  const results: TrajectoryPointResult[] = [];
  let okCount = 0;
  let dataCount = 0;
  let errorCount = 0;
  let bestIdx: number | null = null;
  let worstIdx: number | null = null;
  let bestMargin = -Infinity;
  let worstMargin = Infinity;

  for (let i = 0; i < trajectory.points.length; i++) {
    const tp = trajectory.points[i];
    const base: TrajectoryPointResult = {
      idx: i,
      lat: tp.lat,
      lon: tp.lon,
      altitudeM: tp.altitudeM,
      terrainM: null,
      aglM: null,
      distanceM: 0,
      fwdAzDeg: 0,
      fspl: null,
      diffLossDb: null,
      prxDbm: null,
      marginDb: null,
      ok: false,
      status: "error",
    };

    try {
      const inv = vincentyInverse(txWgs, { lat: tp.lat, lon: tp.lon });
      const D = inv.distance;
      if (D < 1) throw new Error("точка совпадает с ПРД");
      if (D > 1000_000) throw new Error("дальность более 1000 км");

      const nPts = clamp(Math.round(D / 900), 18, 120);
      const raw = buildProfileRaw(
        tiles,
        txWgs,
        inv.fwdAz,
        D,
        nPts,
        params.kFactor,
        !!params.useSynthetic
      );
      let terrain = sampleHeight(tiles, tp.lat, tp.lon);
      if (terrain === null && params.useSynthetic) {
        terrain = syntheticElevation(tp.lat, tp.lon);
      }
      // altitude из .rt — высота над уровнем моря (AMSL).
      // tripodHeight — доп. высота антенны над этой отметкой (если задана).
      const tripod = trajectory.tripodHeightM ?? 0;
      const h2 = tp.altitudeM + tripod;
      const h1 = raw.txTerrainM + params.txAntHM;

      const pts = deriveProfile(raw, h1, h2, params.fMHz);
      const diff = diffractionLoss(
        pts.map((p) => ({ d: p.d, hc: p.hc })),
        h1,
        h2,
        params.fMHz
      );
      const fspl = fsplDb(D, params.fMHz);
      const prx =
        params.pTxDbm -
        params.txFeederDb +
        params.txGainDbi -
        fspl -
        diff.loss -
        params.extraLossDb +
        params.rxGainDbi -
        params.rxFeederDb;
      const margin = prx - params.sensitivityDbm;
      const ok = margin >= params.fadeMarginDb;

      results.push({
        ...base,
        terrainM: raw.rxTerrainM,
        aglM: h2 - raw.rxTerrainM,
        distanceM: D,
        fwdAzDeg: normalizeAzDeg(inv.fwdAz * (180 / Math.PI)),
        fspl,
        diffLossDb: diff.loss,
        prxDbm: prx,
        marginDb: margin,
        ok,
        status: "ok",
      });
      if (ok) okCount++;
      if (margin > bestMargin) {
        bestMargin = margin;
        bestIdx = i;
      }
      if (margin < worstMargin) {
        worstMargin = margin;
        worstIdx = i;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ошибка расчёта";
      const isData = msg.includes("HGT");
      if (isData) dataCount++;
      else errorCount++;
      results.push({
        ...base,
        status: isData ? "data" : "error",
        message: isData ? "нет данных HGT на трассе" : msg,
      });
    }
  }

  return {
    points: results,
    tripodHeightM: trajectory.tripodHeightM,
    fMHz: params.fMHz,
    okCount,
    dataCount,
    errorCount,
    bestIdx,
    worstIdx,
  };
}


/** Свип потерь по частоте (из Grok_freqcalc). */
export function frequencySweep(
  tiles: HgtTileMap,
  geom: PathGeom,
  params: RadioParams,
  fStartMHz: number,
  fStopMHz: number,
  fStepMHz: number
): Array<{ freq_mhz: number; path_loss_db: number; prx_dbm: number; margin_db: number }> {
  const out: Array<{
    freq_mhz: number;
    path_loss_db: number;
    prx_dbm: number;
    margin_db: number;
  }> = [];
  const step =
    fStepMHz > 0 ? fStepMHz : Math.max((fStopMHz - fStartMHz) / 20, 0.1);
  for (let f = fStartMHz; f <= fStopMHz + step * 0.01; f += step) {
    const p: RadioParams = { ...params, fMHz: f };
    try {
      const res = evaluateLink(tiles, geom, p);
      const pathLoss = res.fspl + res.diff.loss + (params.extraLossDb || 0);
      out.push({
        freq_mhz: +f.toFixed(4),
        path_loss_db: +pathLoss.toFixed(2),
        prx_dbm: +res.prxDbm.toFixed(2),
        margin_db: +res.marginDb.toFixed(2),
      });
    } catch {
      /* skip */
    }
  }
  return out;
}
