// Клиент off-thread расчётов (Фаза 2, задача 2.1).
// Единственная точка входа UI к вычислениям движка: тяжёлые задачи
// (link/coverage/vertical/trajectory) выполняются в Web Worker; при его
// недоступности — синхронный фолбэк в текущем потоке. Поддержка отмены
// через AbortSignal. Результаты worker'а идентичны синхронным функциям
// engine.ts (общий код ядра, тот же порядок операций).

import {
  evaluateLink,
  evaluateTrajectory,
  scanCoverage,
  verticalAnalysis,
  type CoverageResult,
  type LinkResult,
  type PathGeom,
  type RadioParams,
  type TrajectoryResult,
  type VerticalResult,
} from "./engine";
import type { HgtTile, HgtTileMap } from "./hgt";
import type { LatLon } from "./geodesy";
import type { Sk42Point } from "./sk42";
import type {
  EngineDone,
  EngineResponse,
  EngineTask,
  TileTransfer,
} from "./engine-protocol";
import {
  cacheGetCoverage,
  cacheGetLink,
  cacheGetTrajectory,
  cacheGetVertical,
  cacheSetCoverage,
  cacheSetLink,
  cacheSetTrajectory,
  cacheSetVertical,
  terrainHash,
} from "./engine-cache";

export interface LinkRequest {
  tiles: HgtTileMap;
  geom: PathGeom;
  tx: Sk42Point;
  rx: Sk42Point;
  freqsMHz: number[];
  params: RadioParams;
  signal?: AbortSignal;
}

export interface CoverageRequest {
  tiles: HgtTileMap;
  txWgs: LatLon;
  params: RadioParams;
  analysisKm: number;
  signal?: AbortSignal;
}

export interface VerticalRequest {
  tiles: HgtTileMap;
  txWgs: LatLon;
  azDeg: number;
  distanceKm: number;
  params: RadioParams;
  maxHM: number;
  stepHM: number;
  signal?: AbortSignal;
}

export interface TrajectoryRequest {
  tiles: HgtTileMap;
  txWgs: LatLon;
  txSk42: Sk42Point;
  points: Array<{ lat: number; lon: number; altitudeM: number }>;
  tripodHeightM: number | null;
  params: RadioParams;
  signal?: AbortSignal;
}

export class AbortedError extends Error {
  constructor() {
    super("Расчёт отменён");
    this.name = "AbortedError";
  }
}

type Handlers = {
  resolve: (r: EngineResponse) => void;
  reject: (e: unknown) => void;
};

let workerSingleton: Worker | null = null;
let workerBroken = false;
const pending = new Map<number, Handlers>();
let nextId = 1;

function makeTileTransfers(tiles: HgtTileMap): {
  transfers: TileTransfer[];
  clones: ArrayBuffer[];
} {
  const transfers: TileTransfer[] = [];
  const clones: ArrayBuffer[] = [];
  for (const [name, tile] of tiles) {
    // Копия исходного Int16Array — оригинал остаётся в сторе нетронутым;
    // буфер пересылается без копирования (transfer list).
    const copy = new Int16Array(tile.data).buffer;
    clones.push(copy);
    transfers.push({ name, buffer: copy });
  }
  return { transfers, clones };
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (typeof window === "undefined") return null;
  if (typeof Worker === "undefined") return null;
  if (workerSingleton) return workerSingleton;
  try {
    const w = new Worker(
      new URL("./engine-worker.ts", import.meta.url),
      { type: "module" }
    );
    w.addEventListener("message", (ev: MessageEvent<EngineResponse>) => {
      const resp = ev.data;
      const id = resp.type === "done" ? resp.id : resp.error.id;
      const h = pending.get(id);
      if (!h) return;
      pending.delete(id);
      h.resolve(resp);
    });
    w.addEventListener("error", () => {
      workerBroken = true;
      // Все ожидающие задачи падают в синхронный фолбэк ниже не могут —
      // отклоняем их; вызывающие коды обработают ошибку как обычно.
      for (const [, h] of pending) h.reject(new Error("worker unavailable"));
      pending.clear();
      w.terminate();
      workerSingleton = null;
    });
    workerSingleton = w;
    return w;
  } catch {
    workerBroken = true;
    return null;
  }
}

/** Отправить задачу в worker; при недоступности — null (фолбэк снаружи). */
function post(task: Omit<EngineTask, "id">, transfers: ArrayBuffer[]): Promise<EngineResponse> | null {
  const w = getWorker();
  if (!w) return null;
  const id = nextId++;
  return new Promise<EngineResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...task, id }, transfers);
  });
}

async function runOrFallback<T>(
  task: Omit<EngineTask, "id">,
  transfers: ArrayBuffer[],
  signal: AbortSignal | undefined,
  fallback: () => T,
  unwrap: (r: EngineResponse) => T
): Promise<T> {
  if (signal?.aborted) throw new AbortedError();
  const promise = post(task, transfers);
  if (promise) {
    let onAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_, reject) => {
      if (!signal) return;
      onAbort = () => reject(new AbortedError());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const resp = await Promise.race([promise, aborted]);
      return unwrap(resp);
    } finally {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  }
  // Синхронный фолбэк в microtask, чтобы abort и ошибки вели себя
  // как async (единый контракт для вызывающего кода).
  await Promise.resolve();
  if (signal?.aborted) throw new AbortedError();
  return fallback();
}

function unwrapDone(r: EngineResponse): EngineDone {
  if (r.type === "error") throw new Error(r.error.message);
  return r;
}

// --- Фаза 2.2: ключи кеша = terrain-hash + все значимые параметры задачи ---

function paramsKey(p: RadioParams): string {
  const h = p.helm;
  return [
    p.fMHz, p.pTxDbm, p.txGainDbi, p.rxGainDbi, p.txFeederDb, p.rxFeederDb,
    p.extraLossDb, p.txAntHM, p.rxAntHM, p.sensitivityDbm, p.fadeMarginDb,
    p.kFactor, !!p.useSynthetic,
    h.dx, h.dy, h.dz,
  ].join(",");
}

function llKey(l: LatLon): string {
  return `${l.lat},${l.lon}`;
}

export async function requestLink(req: LinkRequest): Promise<LinkResult[]> {
  const freqs = req.freqsMHz.length > 0 ? req.freqsMHz : [req.params.fMHz];
  const key = JSON.stringify([
    "link",
    terrainHash(req.tiles, !!req.params.useSynthetic),
    llKey(req.geom.txWgs),
    llKey(req.geom.rxWgs),
    req.geom.distanceM.toFixed(3),
    req.geom.fwdAzDeg.toFixed(6),
    freqs.join(";"),
    paramsKey(req.params),
  ]);
  const hit = cacheGetLink(key) as LinkResult[] | undefined;
  if (hit) return hit;
  const { transfers, clones } = makeTileTransfers(req.tiles);
  const input = {
    tiles: transfers,
    geom: req.geom,
    tx: req.tx,
    rx: req.rx,
    freqsMHz: req.freqsMHz,
    params: req.params,
  };
  const result = await runOrFallback(
    { kind: "link", input },
    clones,
    req.signal,
    () => freqs.map((f) => evaluateLink(req.tiles, req.geom, { ...req.params, fMHz: f })),
    (r) => {
      const d = unwrapDone(r);
      if (d.kind !== "link") throw new Error("unexpected worker response");
      return d.output.byFreq;
    }
  );
  cacheSetLink(key, result);
  return result;
}

export async function requestCoverage(req: CoverageRequest): Promise<CoverageResult> {
  const key = JSON.stringify([
    "cov",
    terrainHash(req.tiles, !!req.params.useSynthetic),
    llKey(req.txWgs),
    req.analysisKm,
    paramsKey(req.params),
  ]);
  const hit = cacheGetCoverage(key) as CoverageResult | undefined;
  if (hit) return hit;
  const { transfers, clones } = makeTileTransfers(req.tiles);
  const input = {
    tiles: transfers,
    txWgs: req.txWgs,
    params: req.params,
    analysisKm: req.analysisKm,
  };
  const result = await runOrFallback(
    { kind: "coverage", input },
    clones,
    req.signal,
    () => scanCoverage(req.tiles, req.txWgs, req.params, req.analysisKm),
    (r) => {
      const d = unwrapDone(r);
      if (d.kind !== "coverage") throw new Error("unexpected worker response");
      return d.output;
    }
  );
  cacheSetCoverage(key, result);
  return result;
}

export async function requestVertical(req: VerticalRequest): Promise<VerticalResult> {
  const key = JSON.stringify([
    "vert",
    terrainHash(req.tiles, !!req.params.useSynthetic),
    llKey(req.txWgs),
    req.azDeg.toFixed(6),
    req.distanceKm,
    req.maxHM,
    req.stepHM.toFixed(6),
    paramsKey(req.params),
  ]);
  const hit = cacheGetVertical(key) as VerticalResult | undefined;
  if (hit) return hit;
  const { transfers, clones } = makeTileTransfers(req.tiles);
  const input = {
    tiles: transfers,
    txWgs: req.txWgs,
    azDeg: req.azDeg,
    distanceKm: req.distanceKm,
    params: req.params,
    maxHM: req.maxHM,
    stepHM: req.stepHM,
  };
  const result = await runOrFallback(
    { kind: "vertical", input },
    clones,
    req.signal,
    () =>
      verticalAnalysis(
        req.tiles,
        req.txWgs,
        req.azDeg,
        req.distanceKm,
        req.params,
        req.maxHM,
        req.stepHM
      ),
    (r) => {
      const d = unwrapDone(r);
      if (d.kind !== "vertical") throw new Error("unexpected worker response");
      return d.output;
    }
  );
  cacheSetVertical(key, result);
  return result;
}

export async function requestTrajectory(req: TrajectoryRequest): Promise<TrajectoryResult> {
  const key = JSON.stringify([
    "traj",
    terrainHash(req.tiles, !!req.params.useSynthetic),
    llKey(req.txWgs),
    req.tripodHeightM,
    req.points.map((p) => `${p.lat},${p.lon},${p.altitudeM}`).join(";"),
    paramsKey(req.params),
  ]);
  const hit = cacheGetTrajectory(key) as TrajectoryResult | undefined;
  if (hit) return hit;
  const { transfers, clones } = makeTileTransfers(req.tiles);
  const input = {
    tiles: transfers,
    txWgs: req.txWgs,
    txSk42: req.txSk42,
    points: req.points,
    tripodHeightM: req.tripodHeightM,
    params: req.params,
  };
  const result = await runOrFallback(
    { kind: "trajectory", input },
    clones,
    req.signal,
    () =>
      evaluateTrajectory(
        req.tiles,
        req.txWgs,
        req.txSk42,
        { points: req.points, tripodHeightM: req.tripodHeightM },
        req.params
      ),
    (r) => {
      const d = unwrapDone(r);
      if (d.kind !== "trajectory") throw new Error("unexpected worker response");
      return d.output;
    }
  );
  cacheSetTrajectory(key, result);
  return result;
}

/** Освободить worker (для тестов/HMR). Ожидающие задачи будут отклонены. */
export function disposeEngineWorker(): void {
  if (workerSingleton) {
    workerSingleton.terminate();
    workerSingleton = null;
  }
  for (const [, h] of pending) h.reject(new Error("worker disposed"));
  pending.clear();
  workerBroken = false;
}

export type { HgtTile };
