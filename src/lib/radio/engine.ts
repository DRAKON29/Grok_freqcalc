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
  /** Параметры Гельмerta СК-42→WGS-84. Не используется ядром трассы
   *  (геометрия считается заранее в pathGeometry); нужен только для
   *  серелиализуемости RadioParams при пересылке в worker (Фаза 2, 2.1). */
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
  /** Имена использованных тайлов — plain-массив (структурировано
   *  клонируемый, Фаза 2.1); Set доступен через usedTilesSet(). */
  usedTiles: string[];
  missingTiles: string[];
}

export const usedTilesSet = (raw: RawProfile) => new Set(raw.usedTiles);

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
  useSynthetic = false,
  /** Для траектории: не требовать HGT на конце (высота антенны из AMSL файла). */
  softRxEndpoint = false
): RawProfile {
  const n = Math.max(2, Math.round(nPoints));
  const pts: RawProfilePoint[] = [];
  const usedTiles = new Set<string>();
  const missingTiles = new Set<string>();
  let gapCount = 0;
  let lastValid = 0;
  let haveValid = false;

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
      const isTx = i === 0;
      const isRx = i === n;
      if (isTx) {
        throw new Error(
          `Нет данных HGT у станции A (${p.lat.toFixed(4)}°, ${p.lon.toFixed(4)}°) — нужен файл ${key}.hgt`
        );
      }
      if (isRx && !softRxEndpoint) {
        throw new Error(
          `Нет данных HGT у станции B (${p.lat.toFixed(4)}°, ${p.lon.toFixed(4)}°) — нужен файл ${key}.hgt`
        );
      }
      // середина или мягкий конец: берём ближайшую известную высоту
      const fill = haveValid ? lastValid : 0;
      gapCount++;
      pts.push({ d, h: fill, hc: 0, valid: false });
    } else {
      lastValid = h;
      haveValid = true;
      usedTiles.add(key);
      pts.push({ d, h, hc: 0, valid: true });
    }
  }

  // Если конец без HGT (softRx) — экстраполируем с предпоследней валидной
  if (softRxEndpoint && pts.length > 1 && !pts[n].valid && haveValid) {
    pts[n].h = lastValid;
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
    usedTiles: Array.from(usedTiles),
    missingTiles: Array.from(missingTiles),
  };
}

/**
 * Профиль для набора частот за один проход по точкам (Фаза 2.1):
 * los/кривизна уже посчитаны в raw; r1/v вычисляются для всех частот
 * во внутреннем цикле по одной точке — лучший cache locality, чем
 * отдельные проходы deriveProfile на частоту.
 */
export function deriveProfileMulti(
  raw: RawProfile,
  h1AbsM: number,
  h2AbsM: number,
  freqsMHz: number[]
): ProfilePoint[][] {
  const D = raw.distanceM;
  const nf = freqsMHz.length;
  const out: ProfilePoint[][] = Array.from({ length: nf }, () => []);
  for (const p of raw.pts) {
    const los = h1AbsM + ((h2AbsM - h1AbsM) * p.d) / D;
    const inSpan = p.d > 0 && p.d < D;
    for (let fi = 0; fi < nf; fi++) {
      const r1 = inSpan ? fresnelRadiusM(p.d, D - p.d, freqsMHz[fi]) : 0;
      // v = (hc − los)·√2/r1 (знак этапа 1; согласован с evaluateLink)
      const v = r1 > 0 ? ((p.hc - los) * Math.SQRT2) / r1 : -Infinity;
      out[fi].push({ ...p, los, r1, v });
    }
  }
  return out;
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

/** Чистая сборка LinkResult из готового профиля (без пересчёта рельефа).
 *  Используется evaluateLink (main-thread) и engine-worker (Фаза 2.1). */
export function buildLinkResult(
  geom: PathGeom,
  params: RadioParams,
  raw: RawProfile,
  pts: ProfilePoint[]
): LinkResult {
  const D = geom.distanceM;
  const h1 = raw.txTerrainM + params.txAntHM;
  const h2 = raw.rxTerrainM + params.rxAntHM;

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

  return buildLinkResult(geom, params, raw, pts);
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

/**
 * Круговая диаграмма: для каждого азимута — максимальная дальность,
 * на которой запас на входе ПРМ не меньше требуемого.
 *
 * Фаза 2.3 (адаптивный скан вместо brute-force по всей лестнице):
 * 1) Экспоненциальный поиск границы «зелёной» зоны (margin ≥ fade) —
 *    старт с 0.5 км, шаг ×1.8; O(log R) оценок вместо полного прохода.
 * 2) Уточнение бисекцией до ±5 м (≤14 итераций).
 * 3) Монотонность ослабления с дальностью позволяет рекурсивно пропускать
 *    смежные азимуты: если два соседних луча дали одинаковую границу
 *    (±30 м), промежуточные считаются совпадающими — типично для ровного
 *    рельефа. Спорные промежутки (гребни/долины) дочитываются полностью.
 * Сетка азимутов остаётся прежней (каждые 5°), результат детерминирован.
 */
export function scanCoverage(
  tiles: HgtTileMap,
  txWgs: LatLon,
  params: RadioParams,
  analysisKm: number
): CoverageResult {
  const rays: CoverageRay[] = new Array(72);

  // --- одиночный луч: адаптивный поиск границы + статус ---
  const traceRay = (azDeg: number): CoverageRay => {
    const azRad = (azDeg * Math.PI) / 180;
    let status: CoverageRay["status"] = "ok";

    const evalKm = (km: number): PointEval | null => {
      const res = safeEvaluatePoint(tiles, txWgs, azRad, km * 1000, params);
      return res.dataOk ? res : null; // null = нет данных HGT
    };

    // 1) экспоненциальный поиск первой точки отказа margin ≥ fade
    let loKm = 0; // заведомо зелёная (или 0)
    let hiKm: number | null = null; // первая отказная (fade)
    let probe = 0.5;
    let weakSeen = false; // встречалась жёлтая зона (0 ≤ margin < fade)
    let failWeakKm: number | null = null; // первый отказ margin ≥ 0
    let dataFailKm: number | null = null;
    for (;;) {
      if (probe > analysisKm) break; // весь радиус зелёный
      const res = evalKm(probe);
      if (res === null) {
        status = "data";
        dataFailKm = probe;
        break;
      }
      if (res.margin >= params.fadeMarginDb) {
        loKm = probe;
      } else {
        if (res.margin >= 0) weakSeen = true;
        else if (failWeakKm === null) failWeakKm = probe;
        hiKm = probe;
        break;
      }
      probe *= 1.8;
    }

    // 2) бисекция границы зелёной зоны
    let km = loKm;
    if (hiKm !== null && loKm < hiKm) {
      let lo = loKm;
      let hi = hiKm;
      while (hi - lo > 5 / 1000) {
        const mid = (lo + hi) / 2;
        const res = evalKm(mid);
        if (res && res.margin >= params.fadeMarginDb) lo = mid;
        else hi = mid;
      }
      km = lo;
    } else if (status !== "data" && hiKm === null && loKm > 0) {
      // всё до analysisKm зелёное → луч упёрся в радиус анализа
      km = analysisKm;
    }

    // граница слабой зоны (margin ≥ 0)
    let kmWeak = km;
    if (status !== "data") {
      if (failWeakKm !== null) {
        // ищем первую точку margin < 0 между границей зелёной зоны и первым
        // отказом margin ≥ 0 (между ними мог быть локальный спад)
        const firstBelowZero = (a: number, b: number): number => {
          let l = a;
          let h = b;
          while (h - l > 5 / 1000) {
            const mid = (l + h) / 2;
            const res = evalKm(mid);
            if (res && res.margin >= 0) l = mid;
            else h = mid;
          }
          return l;
        };
        kmWeak = firstBelowZero(km, failWeakKm);
      } else if (dataFailKm !== null && km < dataFailKm) {
        let l = km;
        let h = dataFailKm;
        while (h - l > 5 / 1000) {
          const mid = (l + h) / 2;
          const res = evalKm(mid);
          if (res) l = mid;
          else h = mid;
        }
        kmWeak = l;
      } else if (hiKm === null && status === "ok") {
        kmWeak = analysisKm;
      } else if (!weakSeen && km >= analysisKm * 0.98) {
        kmWeak = analysisKm;
      }
    } else if (km === 0) {
      // сразу нет данных во всех направлениях
      kmWeak = 0;
    }

    if (
      status === "ok" &&
      (hiKm === null || loKm >= analysisKm * 0.98) &&
      dataFailKm === null
    ) {
      status = "limit";
      km = Math.max(km, analysisKm);
    }

    kmWeak = Math.max(kmWeak, km);
    if (status === "limit") kmWeak = Math.max(kmWeak, analysisKm);
    return { azDeg, km, kmWeak, status };
  };

  // --- основной проход по чётным азимутам (шаг 10°) ---
  const idxOf = (az: number) => az / 5;

  // --- рекурсивная дочистка нечётных азимутов (skip-оптимизация) ---
  // Кольцо из 72 лучей с шагом 5°. Соседями луча i являются i−1 и i+1 по модулю
  // 72 — так корректно обрабатывается стык 355° ↔ 0° (wrap-around).
  const NEIGHBOR_TOL_M = 30;
  const sameBoundary = (a: CoverageRay, b: CoverageRay) =>
    a.status === b.status &&
    Math.abs(a.km - b.km) * 1000 <= NEIGHBOR_TOL_M &&
    Math.abs(a.kmWeak - b.kmWeak) * 1000 <= NEIGHBOR_TOL_M;

  // Если оба соседа луча совпадают по границе — луч повторяет их (типично для
  // ровного рельефа). Иначе — точная трассировка.
  const resolveOdd = (idx: number): CoverageRay => {
    const left = rays[((idx - 1) % 72 + 72) % 72];
    const right = rays[(idx + 1) % 72];
    if (sameBoundary(left, right)) {
      return { ...left, azDeg: idx * 5 };
    }
    return traceRay(idx * 5);
  };

  // Основной проход: каждый второй луч (шаг 10°) считается точно.
  for (let az = 0; az < 360; az += 10) {
    rays[idxOf(az)] = traceRay(az);
  }
  // Дочистка нечётных азимутов (шаг 5°) по готовым соседям.
  for (let i = 1; i < 72; i += 2) {
    rays[i] = resolveOdd(i);
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
        !!params.useSynthetic,
        true // softRx: высота B из altitude AMSL файла
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
