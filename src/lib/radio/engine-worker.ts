// Web Worker тяжёлых расчётов (Фаза 2, задача 2.1).
// Принимает EngineTask (engine-protocol.ts), парсит присланные бинарные HGT,
// выполняет расчёт вне основного потока и отвечает EngineDone/EngineError.
// Все результаты — plain-объекты (structurally cloneable): без Map/Set/функций.

import {
  buildLinkResult,
  buildProfileRaw,
  deriveProfileMulti,
  evaluateTrajectory,
  scanCoverage,
  verticalAnalysis,
  type LinkResult,
  type RadioParams,
} from "./engine";
import { parseHgt, type HgtTileMap } from "./hgt";
import type {
  EngineResponse,
  EngineTask,
  LinkInput,
  TileTransfer,
} from "./engine-protocol";

// Минимальный тип контекста dedicated worker (lib "webworker" в tsconfig не включён,
// поэтому DedicatedWorkerGlobalScope описываем локально).
interface WorkerMessageEvent {
  data: EngineTask;
}
interface MinimalWorkerScope {
  postMessage(message: EngineResponse, transfer?: ArrayBuffer[]): void;
  onmessage: ((ev: WorkerMessageEvent) => void) | null;
  addEventListener(type: "message", listener: (ev: WorkerMessageEvent) => void): void;
}

const ctx = self as unknown as MinimalWorkerScope;

/** Парсинг пересланных тайлов в HgtTileMap (только нужные движку поля). */
function loadTiles(transfers: TileTransfer[]): HgtTileMap {
  const tiles: HgtTileMap = new Map();
  for (const t of transfers) {
    if (!tiles.has(t.name)) tiles.set(t.name, parseHgt(t.name, t.buffer));
  }
  return tiles;
}

/** Собрать LinkResult по одному профилю рельефа для каждого частотного входа. */
function computeLink(input: LinkInput): LinkResult[] {
  const tiles = loadTiles(input.tiles);
  const D = input.geom.distanceM;
  if (D < 1) throw new Error("Точки ПРД и ПРМ совпадают");
  if (D > 1000_000) throw new Error("Дальность более 1000 км — модель неприменима");

  const step = Math.max(25, D / 400);
  const nPts = Math.min(500, Math.max(30, Math.ceil(D / step)));
  // Единственный проход по DEM — профиль raw общий для всех частот.
  const raw = buildProfileRaw(
    tiles,
    input.geom.txWgs,
    (input.geom.fwdAzDeg * Math.PI) / 180,
    D,
    nPts,
    input.params.kFactor,
    !!input.params.useSynthetic
  );
  const freqs =
    input.freqsMHz.length > 0 ? input.freqsMHz : [input.params.fMHz];
  const profiles = deriveProfileMulti(
    raw,
    raw.txTerrainM + input.params.txAntHM,
    raw.rxTerrainM + input.params.rxAntHM,
    freqs
  );
  return profiles.map((pts, i) => {
    const params: RadioParams = { ...input.params, fMHz: freqs[i] };
    return buildLinkResult(input.geom, params, raw, pts);
  });
}

function run(task: EngineTask): EngineResponse {
  switch (task.kind) {
    case "link":
      return { type: "done", kind: "link", id: task.id, output: { byFreq: computeLink(task.input) } };
    case "coverage": {
      const i = task.input;
      return {
        type: "done",
        kind: "coverage",
        id: task.id,
        output: scanCoverage(loadTiles(i.tiles), i.txWgs, i.params, i.analysisKm),
      };
    }
    case "vertical": {
      const i = task.input;
      return {
        type: "done",
        kind: "vertical",
        id: task.id,
        output: verticalAnalysis(
          loadTiles(i.tiles),
          i.txWgs,
          i.azDeg,
          i.distanceKm,
          i.params,
          i.maxHM,
          i.stepHM
        ),
      };
    }
    case "trajectory": {
      const i = task.input;
      return {
        type: "done",
        kind: "trajectory",
        id: task.id,
        output: evaluateTrajectory(
          loadTiles(i.tiles),
          i.txWgs,
          i.txSk42,
          { points: i.points, tripodHeightM: i.tripodHeightM },
          i.params
        ),
      };
    }
  }
}

ctx.addEventListener("message", (ev) => {
  const task = ev.data;
  try {
    const resp = run(task);
    // Результаты — plain-объекты; transfer не нужен (буферы уже our копии).
    ctx.postMessage(resp);
  } catch (e) {
    const resp: EngineResponse = {
      type: "error",
      error: { id: task.id, message: e instanceof Error ? e.message : String(e) },
    };
    ctx.postMessage(resp);
  }
});
