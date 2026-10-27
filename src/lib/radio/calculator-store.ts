// Стор калькулятора (Фаза 1, задача 1.3).
// Единый источник истины: сырые поля ввода + режимы + рельеф + траектория.
// Вся производная математика (разбор полей, СК-42, бюджет линии) — чистые
// функции ниже; компоненты вызывают их через useDerived() одним useMemo,
// что устраняет хрупкую цепочку useEffect из старого radio-calculator.tsx.

import { useEffect, useMemo } from "react";
import { create } from "zustand";

import { parseNum } from "./format";
import { DEFAULTS, RADIO_FIELDS } from "./form";
import type { CoordMode, FreqMode, Polarization, PowerUnit } from "./form";
import {
  pathGeometry,
  requiredTileNames,
  type CoverageResult,
  type LinkResult,
  type PathGeom,
  type RadioParams,
} from "./engine";
import { requestLink, requestTrajectory } from "./engine-client";
import { clearEngineCache } from "./engine-cache";
import { parseHgt, tileKeyAt, type HgtTile } from "./hgt";
import {
  DEFAULT_HELMERT_SK42_WGS84,
  gkForward,
  gkInverse,
  sk42ToWgs84,
  wgs84ToSk42,
  zoneForLon,
  type Sk42Point,
} from "./sk42";
import { clearAllTiles, loadAllCachedBuffers, saveTile } from "./tile-cache";
import { parseTrajectoryFile, type Trajectory } from "./route";
import { type TrajectoryResult } from "./engine";
import type { LatLon } from "./geodesy";

export interface CalculatorState {
  // --- сырой ввод ---
  values: Record<string, string>;
  coordMode: CoordMode;
  powerUnit: PowerUnit;
  freqMode: FreqMode;
  polarization: Polarization;
  radiusKm: number;
  vertMaxHM: number;

  // --- рельеф ---
  tiles: Map<string, HgtTile>;
  useSynthetic: boolean;
  tileErrors: string[];
  reading: boolean;
  cacheLoading: boolean;
  cacheCount: number;

  // --- карта и траектория ---
  pickMode: "tx" | "rx";
  trajectory: Trajectory | null;
  trajectoryResult: TrajectoryResult | null;
  trajectoryBusy: boolean;
  trajectoryWarnings: string[];
  trajectoryError: string | null;

  // --- результаты тяжёлых расчётов (пишут эффекты панелей) ---
  coverage: CoverageResult | null;
  coverageBusy: boolean;
  vertical: VerticalResultLike | null;
  verticalBusy: boolean;

  // --- link-результаты: асинхронный off-thread пересчёт (Фаза 2.1) ---
  link: LinkResult | null;
  linkError: string | null;
  linkBusy: boolean;
  linkLow: LinkResult | null;
  linkHigh: LinkResult | null;
  linkReturn: LinkResult | null;
  linkRxLow: LinkResult | null;
  linkRxHigh: LinkResult | null;

  // --- действия ---
  setField: (key: string, v: string) => void;
  setCoordMode: (m: CoordMode) => void;
  switchPowerUnit: (u: PowerUnit) => void;
  switchFreqMode: (m: FreqMode) => void;
  setPolarization: (p: Polarization) => void;
  setRadiusKm: (km: number) => void;
  setVertMaxHM: (hm: number) => void;
  resetAll: () => void;
  syncVertFromLink: () => void;

  setPickMode: (m: "tx" | "rx") => void;
  togglePickMode: () => void;
  handleMapPick: (lat: number, lon: number) => void;

  restoreCachedTiles: () => Promise<void>;
  addTileFiles: (files: FileList | null) => Promise<void>;
  removeCachedTiles: () => Promise<void>;
  setUseSynthetic: (v: boolean) => void;

  loadTrajectoryFile: (files: FileList | null) => void;
  clearTrajectory: () => void;
  recalcTrajectory: () => void;

  setCoverage: (r: CoverageResult | null) => void;
  setCoverageBusy: (b: boolean) => void;
  setVertical: (r: VerticalResultLike | null) => void;
  setVerticalBusy: (b: boolean) => void;
}

/** Тип результата вертикального анализа без импорта engine-дженериков. */
export type VerticalResultLike = import("./engine").VerticalResult;

const initialForm = {
  values: { ...DEFAULTS },
  coordMode: "deg" as CoordMode,
  powerUnit: "dBm" as PowerUnit,
  freqMode: "single" as FreqMode,
  polarization: "V" as Polarization,
  radiusKm: 28,
  vertMaxHM: 50,
};

const initialTerrain = {
  tiles: new Map<string, HgtTile>(),
  useSynthetic: false,
  tileErrors: [] as string[],
  reading: false,
  // Изначально true: restoreCachedTiles() восстановит тайлы из IndexedDB.
  cacheLoading: true,
  cacheCount: 0,
};

const initialTraj = {
  pickMode: "tx" as const,
  trajectory: null as Trajectory | null,
  trajectoryResult: null as TrajectoryResult | null,
  trajectoryBusy: false,
  trajectoryWarnings: [] as string[],
  trajectoryError: null as string | null,
};

const initialResults = {
  coverage: null as CoverageResult | null,
  coverageBusy: false,
  vertical: null as VerticalResultLike | null,
  verticalBusy: false,
  // Фаза 2.1: трассовые расчёты выполняются off-thread (engine-client),
  // результаты пишутся асинхронно в стор.
  link: null as LinkResult | null,
  linkError: null as string | null,
  linkBusy: false,
  linkLow: null as LinkResult | null,
  linkHigh: null as LinkResult | null,
  linkReturn: null as LinkResult | null,
  linkRxLow: null as LinkResult | null,
  linkRxHigh: null as LinkResult | null,
};

// ============================================================
// Чистые производные (перенесены 1-в-1 из radio-calculator.tsx)
// ============================================================

export interface ParsedFields {
  bad: Set<string>;
  nums: Record<string, number>;
  radioOk: boolean;
  txFRangeValid: boolean;
  txFMin: number;
  txFMax: number;
  rxFRangeValid: boolean;
  rxFMin: number;
  rxFMax: number;
}

export function parseRadioFields(
  values: Record<string, string>,
  powerUnit: PowerUnit,
  freqMode: FreqMode
): ParsedFields {
  const bad = new Set<string>();
  const nums: Record<string, number> = {};

  // Мощность: перевод из мВт в дБм
  const rawPower = parseNum(values.pTxDbm ?? "");
  if (powerUnit === "mW") {
    if (!Number.isFinite(rawPower) || rawPower <= 0 || rawPower > 1e6) {
      bad.add("pTxDbm");
    } else {
      nums.pTxDbm = 10 * Math.log10(rawPower);
    }
  } else {
    if (!Number.isFinite(rawPower) || rawPower < -30 || rawPower > 60) {
      bad.add("pTxDbm");
    } else {
      nums.pTxDbm = rawPower;
    }
  }

  // Стандартные поля (fMHz пропускаем в режиме диапазона)
  for (const f of RADIO_FIELDS) {
    if (freqMode === "range" && f.key === "fMHz") continue;
    const v = parseNum(values[f.key] ?? "");
    if (!Number.isFinite(v) || v < f.min || v > f.max) bad.add(f.key);
    else nums[f.key] = v;
  }

  // Диапазоны частот ПРД и ПРМ
  let txFRangeValid = false;
  let txFMin = 0;
  let txFMax = 0;
  let rxFRangeValid = false;
  let rxFMin = 0;
  let rxFMax = 0;
  if (freqMode === "range") {
    txFMin = parseNum(values.txFMinMHz ?? "");
    txFMax = parseNum(values.txFMaxMHz ?? "");
    rxFMin = parseNum(values.rxFMinMHz ?? "");
    rxFMax = parseNum(values.rxFMaxMHz ?? "");
    if (!Number.isFinite(txFMin) || txFMin < 50 || txFMin > 7000) bad.add("txFMinMHz");
    if (!Number.isFinite(txFMax) || txFMax < 50 || txFMax > 7000) bad.add("txFMaxMHz");
    if (Number.isFinite(txFMin) && Number.isFinite(txFMax) && txFMax <= txFMin)
      bad.add("txFMaxMHz");
    if (!Number.isFinite(rxFMin) || rxFMin < 50 || rxFMin > 7000) bad.add("rxFMinMHz");
    if (!Number.isFinite(rxFMax) || rxFMax < 50 || rxFMax > 7000) bad.add("rxFMaxMHz");
    if (Number.isFinite(rxFMin) && Number.isFinite(rxFMax) && rxFMax <= rxFMin)
      bad.add("rxFMaxMHz");
    txFRangeValid = !bad.has("txFMinMHz") && !bad.has("txFMaxMHz");
    rxFRangeValid = !bad.has("rxFMinMHz") && !bad.has("rxFMaxMHz");
  }

  // Ширина луча (опциональна)
  const bwStr = (values.beamWidthDeg ?? "").trim();
  if (bwStr) {
    const bw = parseNum(bwStr);
    if (!Number.isFinite(bw) || bw < 0 || bw > 360) bad.add("beamWidthDeg");
    else nums.beamWidthDeg = bw;
  }

  return {
    bad,
    nums,
    radioOk: bad.size === 0,
    txFRangeValid,
    txFMin,
    txFMax,
    rxFRangeValid,
    rxFMin,
    rxFMax,
  };
}

export interface CoordPoints {
  tx: Sk42Point | null;
  rx: Sk42Point | null;
  bad: Set<string>;
  txGk: { x: number; y: number } | null;
  rxGk: { x: number; y: number } | null;
}

export function readCoords(
  values: Record<string, string>,
  coordMode: CoordMode
): CoordPoints {
  const res: CoordPoints = {
    tx: null,
    rx: null,
    bad: new Set(),
    txGk: null,
    rxGk: null,
  };

  const readPoint = (prefix: "tx" | "rx"): Sk42Point | null => {
    if (coordMode === "deg") {
      const B = parseNum(values[`${prefix}B`] ?? "");
      const L = parseNum(values[`${prefix}L`] ?? "");
      if (!Number.isFinite(B) || Math.abs(B) > 90) {
        res.bad.add(`${prefix}B`);
        return null;
      }
      if (!Number.isFinite(L) || Math.abs(L) > 180) {
        res.bad.add(`${prefix}L`);
        return null;
      }
      const gk = gkForward(B, L, zoneForLon(L));
      if (prefix === "tx") res.txGk = gk;
      else res.rxGk = gk;
      return { B, L };
    }
    const X = parseNum(values[`${prefix}X`] ?? "");
    const Y = parseNum(values[`${prefix}Y`] ?? "");
    if (!Number.isFinite(X) || X < -5_000_000 || X > 10_000_000) {
      res.bad.add(`${prefix}X`);
      return null;
    }
    if (!Number.isFinite(Y) || Y < 1_000_000 || Y >= 61_000_000) {
      res.bad.add(`${prefix}Y`);
      return null;
    }
    try {
      const inv = gkInverse(X, Y);
      if (prefix === "tx") res.txGk = { x: X, y: Y };
      else res.rxGk = { x: X, y: Y };
      return { B: inv.B, L: inv.L };
    } catch {
      res.bad.add(`${prefix}Y`);
      return null;
    }
  };

  res.tx = readPoint("tx");
  res.rx = readPoint("rx");
  return res;
}

export function toWgs(p: Sk42Point | null): LatLon | null {
  if (!p) return null;
  try {
    return sk42ToWgs84(p.B, p.L, DEFAULT_HELMERT_SK42_WGS84);
  } catch {
    return null;
  }
}

export function buildParams(
  parsed: ParsedFields,
  freqMode: FreqMode,
  useSynthetic: boolean
): RadioParams | null {
  if (!parsed.radioOk) return null;
  const n = parsed.nums;
  const fMHz =
    freqMode === "range" && parsed.txFRangeValid
      ? (parsed.txFMin + parsed.txFMax) / 2
      : n.fMHz;
  return {
    fMHz,
    pTxDbm: n.pTxDbm,
    txGainDbi: n.txGainDbi,
    rxGainDbi: n.rxGainDbi,
    txFeederDb: n.txFeederDb,
    rxFeederDb: n.rxFeederDb,
    extraLossDb: n.extraLossDb,
    txAntHM: n.txAntHM,
    rxAntHM: n.rxAntHM,
    sensitivityDbm: n.sensitivityDbm,
    fadeMarginDb: n.fadeMarginDb,
    kFactor: n.kFactor,
    helm: DEFAULT_HELMERT_SK42_WGS84,
    useSynthetic,
  };
}

export interface Derived {
  parsed: ParsedFields;
  points: CoordPoints;
  txOk: boolean;
  rxOk: boolean;
  txWgs: LatLon | null;
  rxWgs: LatLon | null;
  params: RadioParams | null;
  /** Обратный канал: на частоте ПРМ. */
  returnParams: RadioParams | null;
  /** Зона покрытия: худший случай = макс. частота ПРД. */
  coverageParams: RadioParams | null;
  geom: PathGeom | null;
  required: ReturnType<typeof requiredTileNames>;
  txTileName: string | null;
  txTileReady: boolean;
  beamWidth: number;
}

export function derive(s: CalculatorState): Derived {
  const parsed = parseRadioFields(s.values, s.powerUnit, s.freqMode);
  const points = readCoords(s.values, s.coordMode);
  const txWgs = toWgs(points.tx);
  const rxWgs = toWgs(points.rx);
  const params = buildParams(parsed, s.freqMode, s.useSynthetic);

  const returnParams: RadioParams | null = params
    ? s.freqMode === "range" && parsed.rxFRangeValid
      ? { ...params, fMHz: (parsed.rxFMin + parsed.rxFMax) / 2 }
      : params
    : null;

  const coverageParams: RadioParams | null = params
    ? s.freqMode === "range" && parsed.txFRangeValid
      ? { ...params, fMHz: parsed.txFMax }
      : params
    : null;

  let geom: PathGeom | null = null;
  if (points.tx && points.rx) {
    try {
      geom = pathGeometry(points.tx, points.rx, DEFAULT_HELMERT_SK42_WGS84);
    } catch {
      geom = null;
    }
  }

  // Фаза 2.1: трассовые расчёты выполняются off-thread (engine-client) и
  // пишутся в стор асинхронно (см. useLinkAsync); derive остаётся чистым.
  const required = requiredTileNames(txWgs, rxWgs, s.radiusKm);
  const txTileName = txWgs ? tileKeyAt(txWgs.lat, txWgs.lon) : null;
  const txTileReady = (txTileName !== null && s.tiles.has(txTileName)) || s.useSynthetic;

  return {
    parsed,
    points,
    txOk: points.tx !== null,
    rxOk: points.rx !== null,
    txWgs,
    rxWgs,
    params,
    returnParams,
    coverageParams,
    geom,
    required,
    txTileName,
    txTileReady,
    beamWidth: parsed.nums.beamWidthDeg ?? 0,
  };
}

// ============================================================
// Асинхронный off-thread пересчёт трассы (Фаза 2.1)
// ============================================================

/** Ключ задачи link-пересчёта: меняется только при значимых изменениях. */
export function linkDepKey(s: CalculatorState): string {
  const d = derive(s);
  if (!d.geom || !d.params) return "";
  const p = d.params;
  const f = s.freqMode === "range" ? [s.values.txFMinMHz, s.values.txFMaxMHz, s.values.rxFMinMHz, s.values.rxFMaxMHz] : [s.values.fMHz];
  return JSON.stringify([
    d.geom.distanceM,
    d.geom.fwdAzDeg,
    d.geom.txWgs,
    f,
    p.txAntHM,
    p.rxAntHM,
    p.kFactor,
    p.useSynthetic,
    [...s.tiles.keys()],
  ]);
}

/**
 * Запуск асинхронного расчёта всех вариантов трассы в worker'е (или
 * синхронном фолбэке) с записью результатов в стор. Отменяет предыдущий
 * расчёт через AbortController. Возвращает promise завершения текущей волны.
 */
let linkAbort: AbortController | null = null;

export async function runLinkCompute(): Promise<void> {
  const s = useCalculatorStore.getState();
  // Отменяем предыдущую волну.
  if (linkAbort) linkAbort.abort();
  const ctrl = new AbortController();
  linkAbort = ctrl;
  const d = derive(s);

  if (!d.geom || !d.params) {
    useCalculatorStore.setState({
      link: null,
      linkError: null,
      linkBusy: false,
      linkLow: null,
      linkHigh: null,
      linkReturn: null,
      linkRxLow: null,
      linkRxHigh: null,
    });
    return;
  }

  const base = d.params;
  const rangeMode = s.freqMode === "range";
  const parsed = d.parsed;

  // Собираем набор уникальных частот: основная + границы диапазонов.
  const freqs: number[] = [base.fMHz];
  const push = (f: number | null) => {
    if (f !== null && Number.isFinite(f) && f > 0 && !freqs.includes(f)) freqs.push(f);
  };
  const txFMin = rangeMode && parsed.txFRangeValid ? parsed.txFMin : null;
  const txFMax = rangeMode && parsed.txFRangeValid ? parsed.txFMax : null;
  const rxFMin = rangeMode && parsed.rxFRangeValid ? parsed.rxFMin : null;
  const rxFMax = rangeMode && parsed.rxFRangeValid ? parsed.rxFMax : null;
  const rxFMid = rangeMode && parsed.rxFRangeValid ? (parsed.rxFMin + parsed.rxFMax) / 2 : null;
  push(txFMin); push(txFMax); push(rxFMin); push(rxFMax); push(rxFMid);

  useCalculatorStore.setState({ linkBusy: true, linkError: null });

  try {
    const results = await requestLink({
      tiles: s.tiles,
      geom: d.geom,
      tx: d.points.tx!,
      rx: d.points.rx!,
      freqsMHz: freqs,
      params: base,
      signal: ctrl.signal,
    });
    if (ctrl.signal.aborted) return;
    const byFreq = new Map<number, LinkResult>();
    freqs.forEach((f, i) => byFreq.set(f, results[i]));
    const pick = (f: number | null) => (f !== null ? byFreq.get(f) ?? null : null);
    useCalculatorStore.setState({
      link: byFreq.get(base.fMHz) ?? null,
      linkError: null,
      linkBusy: false,
      linkLow: pick(txFMin),
      linkHigh: pick(txFMax),
      linkReturn: pick(rxFMid),
      linkRxLow: pick(rxFMin),
      linkRxHigh: pick(rxFMax),
    });
  } catch (e) {
    if (ctrl.signal.aborted || (e as Error)?.name === "AbortedError") return;
    useCalculatorStore.setState({
      link: null,
      linkBusy: false,
      linkError: e instanceof Error ? e.message : "Ошибка расчёта трассы",
      linkLow: null,
      linkHigh: null,
      linkReturn: null,
      linkRxLow: null,
      linkRxHigh: null,
    });
  } finally {
    if (linkAbort === ctrl) linkAbort = null;
  }
}

/** Хук: подписан на ключ пересчёта трассы, запускает off-thread расчёт.
 * Фаза 2.2: дебаунс 250 мс — при быстрых правках полей ввода в worker
 * уходит только финальная задача (промежуточные отменяются); повторные
 * идентичные задачи отсекает LRU-кеш движка внутри requestLink. */
export function useLinkAsync(): void {
  const key = useCalculatorStore(linkDepKey);
  useEffect(() => {
    if (!key) {
      useCalculatorStore.setState({
        link: null,
        linkError: null,
        linkBusy: false,
        linkLow: null,
        linkHigh: null,
        linkReturn: null,
        linkRxLow: null,
        linkRxHigh: null,
      });
      return;
    }
    const t = setTimeout(() => void runLinkCompute(), 250);
    return () => clearTimeout(t);
  }, [key]);
}

// ============================================================
// Хелперы переключения единиц/режимов (чистые)
// ============================================================

export function convertedPowerValue(current: string, from: PowerUnit, to: PowerUnit): string {
  if (from === to) return current;
  const v = parseNum(current);
  if (!Number.isFinite(v) || v <= 0) return current;
  if (to === "mW" && from === "dBm") {
    return String(Math.round(Math.pow(10, v / 10) * 1000) / 1000);
  }
  if (to === "dBm" && from === "mW") {
    return String(Math.round(10 * Math.log10(v) * 10) / 10);
  }
  return current;
}

export function freqModeValues(
  current: Record<string, string>,
  from: FreqMode,
  to: FreqMode
): Record<string, string> {
  if (from === to) return current;
  const next = { ...current };
  if (to === "range" && from === "single") {
    const f = parseNum(next.fMHz ?? "");
    if (Number.isFinite(f) && f > 0) {
      const lo = String(Math.round(f * 0.97 * 10) / 10);
      const hi = String(Math.round(f * 1.03 * 10) / 10);
      if (!(next.txFMinMHz ?? "").trim()) next.txFMinMHz = lo;
      if (!(next.txFMaxMHz ?? "").trim()) next.txFMaxMHz = hi;
      if (!(next.rxFMinMHz ?? "").trim()) next.rxFMinMHz = lo;
      if (!(next.rxFMaxMHz ?? "").trim()) next.rxFMaxMHz = hi;
    }
  } else if (to === "single" && from === "range") {
    const fMin = parseNum(next.txFMinMHz ?? "");
    const fMax = parseNum(next.txFMaxMHz ?? "");
    if (Number.isFinite(fMin) && Number.isFinite(fMax)) {
      next.fMHz = String(Math.round(((fMin + fMax) / 2) * 10) / 10);
    }
  }
  return next;
}

// ============================================================
// Стор
// ============================================================

export const useCalculatorStore = create<CalculatorState>()((set, get) => ({
  ...initialForm,
  ...initialTerrain,
  ...initialTraj,
  ...initialResults,

  setField: (key, v) => set((s) => ({ values: { ...s.values, [key]: v } })),
  setCoordMode: (m) => set({ coordMode: m }),

  switchPowerUnit: (newUnit) => {
    const s = get();
    if (newUnit === s.powerUnit) return;
    set({
      powerUnit: newUnit,
      values: {
        ...s.values,
        pTxDbm: convertedPowerValue(s.values.pTxDbm ?? "", s.powerUnit, newUnit),
      },
    });
  },

  switchFreqMode: (mode) => {
    const s = get();
    if (mode === s.freqMode) return;
    set({ freqMode: mode, values: freqModeValues(s.values, s.freqMode, mode) });
  },

  setPolarization: (p) => set({ polarization: p }),
  setRadiusKm: (km) => set({ radiusKm: km }),
  setVertMaxHM: (hm) => set({ vertMaxHM: hm }),

  resetAll: () =>
    set({
      ...initialForm,
      values: { ...DEFAULTS },
      tileErrors: [],
    }),

  syncVertFromLink: () => {
    const d = derive(get());
    if (!d.geom) return;
    set((s) => ({
      values: {
        ...s.values,
        vertDistKm: String(Math.round((d.geom!.distanceM / 1000) * 10) / 10),
        vertAzDeg: String(Math.round(d.geom!.fwdAzDeg * 10) / 10),
      },
    }));
  },

  setPickMode: (m) => set({ pickMode: m }),
  togglePickMode: () => set((s) => ({ pickMode: s.pickMode === "tx" ? "rx" : "tx" })),

  handleMapPick: (lat, lon) => {
    const s = get();
    let B: number, L: number;
    try {
      const sk42 = wgs84ToSk42(lat, lon, DEFAULT_HELMERT_SK42_WGS84);
      B = sk42.B;
      L = sk42.L;
    } catch {
      // Если конвертация не удалась — используем WGS-84 напрямую
      B = lat;
      L = lon;
    }
    if (s.pickMode === "tx") {
      set((st) => ({ values: { ...st.values, txB: String(B), txL: String(L) } }));
    } else {
      set((st) => ({ values: { ...st.values, rxB: String(B), rxL: String(L) } }));
    }
  },

  restoreCachedTiles: async () => {
    try {
      const map = await loadAllCachedBuffers();
      const next = new globalThis.Map<string, HgtTile>();
      for (const [name, { buffer }] of map) {
        try {
          const tile = parseHgt(name, buffer);
          next.set(tile.name, tile);
        } catch {
          // пропускаем повреждённый тайл
        }
      }
      if (next.size > 0) {
        set((s) => {
          const merged = new globalThis.Map(s.tiles);
          for (const [k, v] of next) merged.set(k, v);
          return { tiles: merged };
        });
      }
      set({ cacheCount: next.size });
    } catch {
      // IndexedDB недоступен — работаем без кэша
    } finally {
      set({ cacheLoading: false });
    }
  },

  addTileFiles: async (files) => {
    if (!files || files.length === 0) return;
    set({ reading: true });
    const errors: string[] = [];
    const s = get();
    const next = new globalThis.Map(s.tiles);
    for (const file of Array.from(files)) {
      try {
        const buf = await file.arrayBuffer();
        const tile = parseHgt(file.name, buf);
        next.set(tile.name, tile);
        // Кэшируем тайл, чтобы он пережил перезагрузку страницы.
        try {
          await saveTile(tile.name, buf, tile.arcSec);
          set((st) => ({ cacheCount: st.cacheCount + 1 }));
        } catch {
          // IndexedDB недоступен — тайл работает только в этой сессии
        }
      } catch (e) {
        errors.push(
          e instanceof Error
            ? `${file.name}: ${e.message}`
            : `${file.name}: не удалось прочитать`
        );
      }
    }
    set({ tiles: next, tileErrors: errors, reading: false });
    // Фаза 2.2: рельеф изменился — сбрасываем кеш результатов (hash
    // меняется автоматически, но явная очистка освобождает память).
    clearEngineCache();
  },

  removeCachedTiles: async () => {
    try {
      await clearAllTiles();
    } catch {
      // IndexedDB недоступен
    }
    set({ cacheCount: 0 });
    clearEngineCache();
  },

  setUseSynthetic: (v) => {
    set({ useSynthetic: v });
    clearEngineCache();
  },

  loadTrajectoryFile: (files) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = parseTrajectoryFile(file.name, text);
      set({
        trajectoryWarnings: parsed.warnings,
        trajectoryError: parsed.error,
        trajectory: parsed.trajectory,
      });
      if (parsed.trajectory) get().recalcTrajectory();
    };
    reader.readAsText(file);
  },

  clearTrajectory: () =>
    set({
      trajectory: null,
      trajectoryResult: null,
      trajectoryWarnings: [],
      trajectoryError: null,
    }),

  recalcTrajectory: () => {
    const s = get();
    const d = derive(s);
    if (!s.trajectory || !d.params || !d.txWgs || !d.points.tx) return;
    set({ trajectoryBusy: true, trajectoryResult: null });
    // Фаза 2.1: расчёт вне основного потока (worker + синхронный фолбэк).
    void requestTrajectory({
      tiles: s.tiles,
      txWgs: d.txWgs,
      txSk42: d.points.tx,
      points: s.trajectory.points.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        altitudeM: p.altitudeM,
      })),
      tripodHeightM: s.trajectory.tripodHeightM,
      params: d.params,
    })
      .then((result) => {
        set({ trajectoryResult: result, trajectoryBusy: false });
      })
      .catch((e) => {
        set({
          trajectoryError:
            e instanceof Error ? e.message : "Ошибка расчёта траектории",
          trajectoryBusy: false,
        });
      });
  },

  setCoverage: (r) => set({ coverage: r }),
  setCoverageBusy: (b) => set({ coverageBusy: b }),
  setVertical: (r) => set({ vertical: r }),
  setVerticalBusy: (b) => set({ verticalBusy: b }),
}));

/**
 * Производное состояние (мемоизированный derive). Стабильность результатов
 * обеспечивает zustand-подписка на сериализуемый ключ значимых полей.
 */
export function useDerived(): Derived {
  const depKey = useCalculatorStore(deriveDepKey);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- depKey намеренно единственный триггер: derive() читает свежий снапшот стора
  return useMemo(() => derive(useCalculatorStore.getState()), [depKey]);
}

/** Ключ пересчёта derive(): меняется только при изменении значимых полей. */
const deriveDepKey = (s: CalculatorState): string =>
  JSON.stringify([
    s.values,
    s.coordMode,
    s.powerUnit,
    s.freqMode,
    s.polarization,
    s.radiusKm,
    s.tiles,
    s.useSynthetic,
  ]);
