// Протокол off-thread расчётов (Фаза 2, задача 2.1).
// Единственный контракт между главным потоком и worker'ом: тяжёлые расчёты
// (трасса, coverage, вертикальный анализ, траектория) выполняются вне UI,
// тайлы HGT передаются бинарно (ArrayBuffer + transfer list), результаты —
// структурировано клонируемыми plain-объектами (без Set/Map/функций).

import type {
  CoverageResult,
  LinkResult,
  PathGeom,
  RadioParams,
  TrajectoryResult,
  VerticalResult,
} from "./engine";
import type { LatLon } from "./geodesy";
import type { Sk42Point } from "./sk42";

/** Бинарный тайл HGT для пересылки в worker (имя + исходный файл). */
export interface TileTransfer {
  name: string;
  buffer: ArrayBuffer;
}

export interface LinkInput {
  tiles: TileTransfer[];
  /** Геометрия трассы считается в главном потоке (дешёвая) и пересылается. */
  geom: PathGeom;
  tx: Sk42Point;
  rx: Sk42Point;
  /** Набор частот (МГц) для одного прохода по профилю: все точки профиля
   *  (v/r1) считаются один раз на частоту. Пустой массив = только основная. */
  freqsMHz: number[];
  params: RadioParams;
}

export interface LinkOutput {
  /** Результаты по частоте, порядок совпадает с LinkInput.freqsMHz. */
  byFreq: LinkResult[];
}

export interface CoverageInput {
  tiles: TileTransfer[];
  txWgs: LatLon;
  params: RadioParams;
  analysisKm: number;
}

export interface VerticalInput {
  tiles: TileTransfer[];
  txWgs: LatLon;
  azDeg: number;
  distanceKm: number;
  params: RadioParams;
  maxHM: number;
  stepHM: number;
}

export interface TrajectoryInput {
  tiles: TileTransfer[];
  txWgs: LatLon;
  txSk42: Sk42Point;
  points: Array<{ lat: number; lon: number; altitudeM: number }>;
  tripodHeightM: number | null;
  params: RadioParams;
}

export type EngineTask =
  | { kind: "link"; id: number; input: LinkInput }
  | { kind: "coverage"; id: number; input: CoverageInput }
  | { kind: "vertical"; id: number; input: VerticalInput }
  | { kind: "trajectory"; id: number; input: TrajectoryInput };

export type EngineDone =
  | { kind: "link"; id: number; output: LinkOutput }
  | { kind: "coverage"; id: number; output: CoverageResult }
  | { kind: "vertical"; id: number; output: VerticalResult }
  | { kind: "trajectory"; id: number; output: TrajectoryResult };

export interface EngineError {
  id: number;
  message: string;
}

export type EngineResponse =
  | ({ type: "done" } & EngineDone)
  | { type: "error"; error: EngineError };
