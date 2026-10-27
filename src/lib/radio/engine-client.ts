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

export async function requestLink(req: LinkRequest): Promise<LinkResult[]> {
  const { transfers, clones } = makeTileTransfers(req.tiles);
  const input = {
    tiles: transfers,
    geom: req.geom,
    tx: req.tx,
    rx: req.rx,
    freqsMHz: req.freqsMHz,
    params: req.params,
  };
  return runOrFallback(
    { kind: "link", input },
    clones,
    req.signal,
    () => {
      const freqs = req.freqsMHz.length > 0 ? req.freqsMHz : [req.params.fMHz];
      return freqs.map((f) =>
        evaluateLink(req.tiles, req.geom, { ...req.params, fMHz: f })
      );
    },
    (r) => {
      const d = unwrapDone(r);
      if (d.kind !== "link") throw new Error("unexpected worker response");
      return d.output.byFreq;
    }
  );
}

export async function requestCoverage(req: CoverageRequest): Promise<CoverageResult> {
  const { transfers, clones } = makeTileTransfers(req.tiles);
  const input = {
    tiles: transfers,
    txWgs: req.txWgs,
    params: req.params,
    analysisKm: req.analysisKm,
  };
  return runOrFallback(
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
}

export async function requestVertical(req: VerticalRequest): Promise<VerticalResult> {
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
  return runOrFallback(
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
}

export async function requestTrajectory(req: TrajectoryRequest): Promise<TrajectoryResult> {
  const { transfers, clones } = makeTileTransfers(req.tiles);
  const input = {
    tiles: transfers,
    txWgs: req.txWgs,
    txSk42: req.txSk42,
    points: req.points,
    tripodHeightM: req.tripodHeightM,
    params: req.params,
  };
  return runOrFallback(
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
