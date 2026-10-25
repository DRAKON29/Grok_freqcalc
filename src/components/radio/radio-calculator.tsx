"use client";

// Калькулятор распространения радиосигнала. Вся математика — в src/lib/radio,
// здесь только состояние полей, загрузка HGT-файлов и вызов движка.
// Координаты вводятся вручную строго в СК-42: градусы B/L либо метры
// Гаусса–Крюгера X/Y (с номером зоны в Y). Обе станции — приёмопередатчики;
// координаты станции B опциональны — без них только зона связи вокруг A.

import {
  ArrowUpDown,
  Compass,
  HardDrive,
  Map as LucideMap,
  Mountain,
  RadioTower,
  Route,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CoverageChart } from "@/components/radio/coverage-chart";
import { NumberField } from "@/components/radio/number-field";
import { ProfileChart } from "@/components/radio/profile-chart";
import { VerticalChart } from "@/components/radio/vertical-chart";
import {
  DEFAULT_HELMERT_SK42_WGS84,
  gkForward,
  gkInverse,
  sk42ToWgs84,
  zoneForLon,
  type Sk42Point,
} from "@/lib/radio/sk42";
import { parseHgt, tileKeyAt, type HgtTile } from "@/lib/radio/hgt";
import {
  clearAllTiles,
  loadAllCachedBuffers,
  saveTile,
} from "@/lib/radio/tile-cache";
import {
  pathGeometry,
  requiredTileNames,
  scanCoverage,
  evaluateLink,
  frequencySweep,
  verticalAnalysis,
  type CoverageResult,
  type LinkResult,
  type PathGeom,
  type RadioParams,
  type VerticalResult,
} from "@/lib/radio/engine";
import { MapPicker } from "@/components/radio/map-picker";
import { fmt, fmtDms, parseNum } from "@/lib/radio/format";
import {
  SIGNAL_COLORS,
  SIGNAL_LABELS,
  signalQuality,
} from "@/lib/radio/signal";
import { parseTrajectoryFile, type Trajectory } from "@/lib/radio/route";
import {
  evaluateTrajectory,
  type TrajectoryResult,
} from "@/lib/radio/engine";
import { wgs84ToSk42 } from "@/lib/radio/sk42";
import { cn } from "@/lib/utils";

const DEFAULTS: Record<string, string> = {
  fMHz: "433",
  txFMinMHz: "430",
  txFMaxMHz: "440",
  rxFMinMHz: "430",
  rxFMaxMHz: "440",
  pTxDbm: "40",
  txGainDbi: "3",
  rxGainDbi: "2",
  txFeederDb: "1,5",
  rxFeederDb: "1,5",
  extraLossDb: "0",
  txAntHM: "10",
  rxAntHM: "1,5",
  sensitivityDbm: "-105",
  fadeMarginDb: "10",
  kFactor: "1,33",
  beamWidthDeg: "",
  txB: "55,7558",
  txL: "37,6173",
  rxB: "55,7997",
  rxL: "38,0166",
  txX: "6181399",
  txY: "7419639",
  rxX: "6223358",
  rxY: "7455803",
  vertDistKm: "5",
  vertAzDeg: "0",
};

const ANALYSIS_KM = [2, 4, 6, 9, 13, 19, 28, 42, 62, 92, 135, 200, 290, 420];

interface FieldSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  hint?: string;
  digits?: number;
}

// fMHz и pTxDbm обрабатываются отдельно (переключатели режима/единиц).
const RADIO_FIELDS: FieldSpec[] = [
  { key: "fMHz", label: "Частота", unit: "МГц", min: 50, max: 7000, hint: "от 50 до 7000" },
  { key: "sensitivityDbm", label: "Чувствительность ПРМ", unit: "дБм", min: -160, max: -20 },
  { key: "fadeMarginDb", label: "Запас на замирание", unit: "дБ", min: 0, max: 40 },
  { key: "txGainDbi", label: "Усиление антенны ПРД", unit: "дБи", min: -10, max: 60 },
  { key: "rxGainDbi", label: "Усиление антенны ПРМ", unit: "дБи", min: -10, max: 60 },
  { key: "txFeederDb", label: "Потери фидера ПРД", unit: "дБ", min: 0, max: 30 },
  { key: "rxFeederDb", label: "Потери фидера ПРМ", unit: "дБ", min: 0, max: 30 },
  { key: "extraLossDb", label: "Дополнительные потери", unit: "дБ", min: 0, max: 60 },
  { key: "txAntHM", label: "Высота антенны ПРД над рельефом", unit: "м", min: 0, max: 3000, hint: "до 3000" },
  { key: "rxAntHM", label: "Высота антенны ПРМ над рельефом", unit: "м", min: 0, max: 3000, hint: "до 3000" },
  { key: "kFactor", label: "Коэффициент рефракции k", unit: "", min: 0.1, max: 10, hint: "1,33 — стандартная рефракция" },
];

type CoordMode = "deg" | "gk";
type PowerUnit = "dBm" | "mW";
type FreqMode = "single" | "range";
type Polarization = "V" | "H" | "C";

const POL_LABEL: Record<Polarization, string> = {
  V: "Вертикальная",
  H: "Горизонтальная",
  C: "Круговая",
};

export function RadioCalculator() {
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS);
  const [coordMode, setCoordMode] = useState<CoordMode>("deg");
  const [powerUnit, setPowerUnit] = useState<PowerUnit>("dBm");
  const [freqMode, setFreqMode] = useState<FreqMode>("single");
  const [polarization, setPolarization] = useState<Polarization>("V");
  const [radiusKm, setRadiusKm] = useState(28);
  const [vertMaxHM, setVertMaxHM] = useState(50);
  const [tiles, setTiles] = useState<Map<string, HgtTile>>(new Map());
  const [useSynthetic, setUseSynthetic] = useState(false);
  const [tileErrors, setTileErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [coverageBusy, setCoverageBusy] = useState(false);
  const [vertical, setVertical] = useState<VerticalResult | null>(null);
  const [verticalBusy, setVerticalBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Изначально true: эффект ниже восстановит тайлы из IndexedDB.
  const [cacheLoading, setCacheLoading] = useState(true);
  const [cacheCount, setCacheCount] = useState(0);

  // --- Карта и траектория ---
  const [pickMode, setPickMode] = useState<"tx" | "rx">("tx");
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null);
  const [trajectoryResult, setTrajectoryResult] = useState<TrajectoryResult | null>(null);
  const [trajectoryBusy, setTrajectoryBusy] = useState(false);
  const [trajectoryWarnings, setTrajectoryWarnings] = useState<string[]>([]);
  const [trajectoryError, setTrajectoryError] = useState<string | null>(null);
  const trajFileRef = useRef<HTMLInputElement>(null);

  const set = (key: string, v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  // --- Обработчик клика по карте (WGS-84 → СК-42) ---
  const handleMapPick = (lat: number, lon: number) => {
    try {
      // Проверяем, что координаты в допустимых пределах для СК-42
      if (lat < 40 || lat > 82 || lon < 15 || lon > 170) {
        // Выход за пределы территории применения СК-42 — оставляем только WGS-84
        // (на самом деле преобразование всё равно сработает)
      }
      const sk42 = wgs84ToSk42(
        lat,
        lon,
        DEFAULT_HELMERT_SK42_WGS84
      );
      const dmsB = fmtDms(sk42.B, "lat");
      const dmsL = fmtDms(sk42.L, "lon");
      if (pickMode === "tx") {
        set("txB", String(sk42.B));
        set("txL", String(sk42.L));
      } else {
        set("rxB", String(sk42.B));
        set("rxL", String(sk42.L));
      }
    } catch {
      // Если конвертация не удалась — используем WGS-84 напрямую
      if (pickMode === "tx") {
        set("txB", String(lat));
        set("txL", String(lon));
      } else {
        set("rxB", String(lat));
        set("rxL", String(lon));
      }
    }
  };

  // --- Загрузка файла траектории ПРМ (.rt) ---
  const handleTrajectoryFile = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = parseTrajectoryFile(file.name, text);
      setTrajectoryWarnings(parsed.warnings);
      setTrajectoryError(parsed.error);
      setTrajectory(parsed.trajectory);
      if (parsed.trajectory && params && txWgs && points.tx) {
        calculateTrajectory(parsed.trajectory);
      }
    };
    reader.readAsText(file);
  };

  // --- Расчёт радиолинии по всем точкам траектории ---
  const calculateTrajectory = (traj: Trajectory) => {
    if (!params || !txWgs || !points.tx) return;
    setTrajectoryBusy(true);
    setTrajectoryResult(null);
    // Вычисляем в микротаске, чтобы UI обновился
    setTimeout(() => {
      try {
        if (!points.tx) return;
        const result = evaluateTrajectory(
          tiles,
          txWgs,
          points.tx,
          {
            points: traj.points.map((p) => ({
              lat: p.lat,
              lon: p.lon,
              altitudeM: p.altitudeM,
            })),
            tripodHeightM: traj.tripodHeightM,
          },
          params
        );
        setTrajectoryResult(result);
      } catch (e) {
        setTrajectoryError(
          e instanceof Error ? e.message : "Ошибка расчёта траектории"
        );
      } finally {
        setTrajectoryBusy(false);
      }
    }, 50);
  };

  // --- Очистка траектории ---
  const clearTrajectory = () => {
    setTrajectory(null);
    setTrajectoryResult(null);
    setTrajectoryWarnings([]);
    setTrajectoryError(null);
    if (trajFileRef.current) trajFileRef.current.value = "";
  };

  // --- загрузка тайлов из кэша IndexedDB при монтировании ---
  useEffect(() => {
    let cancelled = false;
    loadAllCachedBuffers()
      .then((map) => {
        if (cancelled) return;
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
          setTiles((prev) => {
            const merged = new globalThis.Map(prev);
            for (const [k, v] of next) merged.set(k, v);
            return merged;
          });
        }
        setCacheCount(next.size);
      })
      .catch(() => {
        // IndexedDB недоступен — работаем без кэша
      })
      .finally(() => {
        if (!cancelled) setCacheLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- переключение единиц мощности ---
  const switchPowerUnit = (newUnit: PowerUnit) => {
    if (newUnit === powerUnit) return;
    const v = parseNum(values.pTxDbm ?? "");
    if (Number.isFinite(v) && v > 0) {
      if (newUnit === "mW" && powerUnit === "dBm") {
        set("pTxDbm", String(Math.round(Math.pow(10, v / 10) * 1000) / 1000));
      } else if (newUnit === "dBm" && powerUnit === "mW") {
        set("pTxDbm", String(Math.round(10 * Math.log10(v) * 10) / 10));
      }
    }
    setPowerUnit(newUnit);
  };

  // --- переключение режима частоты ---
  const switchFreqMode = (mode: FreqMode) => {
    if (mode === freqMode) return;
    if (mode === "range" && freqMode === "single") {
      const f = parseNum(values.fMHz ?? "");
      if (Number.isFinite(f) && f > 0) {
        const lo = String(Math.round(f * 0.97 * 10) / 10);
        const hi = String(Math.round(f * 1.03 * 10) / 10);
        if (!(values.txFMinMHz ?? "").trim()) set("txFMinMHz", lo);
        if (!(values.txFMaxMHz ?? "").trim()) set("txFMaxMHz", hi);
        if (!(values.rxFMinMHz ?? "").trim()) set("rxFMinMHz", lo);
        if (!(values.rxFMaxMHz ?? "").trim()) set("rxFMaxMHz", hi);
      }
    } else if (mode === "single" && freqMode === "range") {
      const fMin = parseNum(values.txFMinMHz ?? "");
      const fMax = parseNum(values.txFMaxMHz ?? "");
      if (Number.isFinite(fMin) && Number.isFinite(fMax)) {
        set("fMHz", String(Math.round(((fMin + fMax) / 2) * 10) / 10));
      }
    }
    setFreqMode(mode);
  };

  // --- разбор числовых полей ---
  const parsed = useMemo(() => {
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
  }, [values, powerUnit, freqMode]);

  // --- координаты СК-42 ---
  const points = useMemo(() => {
    const res: {
      tx: Sk42Point | null;
      rx: Sk42Point | null;
      bad: Set<string>;
      txGk: { x: number; y: number } | null;
      rxGk: { x: number; y: number } | null;
    } = { tx: null, rx: null, bad: new Set(), txGk: null, rxGk: null };

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
  }, [values, coordMode]);

  const txOk = points.tx !== null;
  const rxOk = points.rx !== null;

  // --- WGS-84 отдельно для ПРД и ПРМ ---
  const txWgs = useMemo(() => {
    if (!points.tx) return null;
    try {
      return sk42ToWgs84(points.tx.B, points.tx.L, DEFAULT_HELMERT_SK42_WGS84);
    } catch {
      return null;
    }
  }, [points]);

  const rxWgs = useMemo(() => {
    if (!points.rx) return null;
    try {
      return sk42ToWgs84(points.rx.B, points.rx.L, DEFAULT_HELMERT_SK42_WGS84);
    } catch {
      return null;
    }
  }, [points]);

  // --- параметры (прямой канал: частота ПРД) ---
  const params: RadioParams | null = useMemo(() => {
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
  }, [parsed, freqMode, useSynthetic]);

  // --- параметры обратного канала (частота ПРМ) ---
  const returnParams: RadioParams | null = useMemo(() => {
    if (!params) return null;
    if (freqMode === "range" && parsed.rxFRangeValid) {
      return { ...params, fMHz: (parsed.rxFMin + parsed.rxFMax) / 2 };
    }
    return params;
  }, [params, freqMode, parsed.rxFRangeValid, parsed.rxFMin, parsed.rxFMax]);

  // --- параметры для зоны покрытия (худший случай = макс. частота ПРД) ---
  const coverageParams: RadioParams | null = useMemo(() => {
    if (!params) return null;
    if (freqMode === "range" && parsed.txFRangeValid) {
      return { ...params, fMHz: parsed.txFMax };
    }
    return params;
  }, [params, freqMode, parsed.txFRangeValid, parsed.txFMax]);

  // --- геометрия трассы (нужны обе точки) ---
  const geom: PathGeom | null = useMemo(() => {
    if (!points.tx || !points.rx) return null;
    try {
      return pathGeometry(points.tx, points.rx, DEFAULT_HELMERT_SK42_WGS84);
    } catch {
      return null;
    }
  }, [points]);

  const link: LinkResult | null = useMemo(() => {
    if (!geom || !params) return null;
    try {
      return evaluateLink(tiles, geom, params);
    } catch {
      return null;
    }
  }, [tiles, geom, params]);

  const linkError = useMemo(() => {
    if (!geom || !params || link) return null;
    try {
      evaluateLink(tiles, geom, params);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Ошибка расчёта трассы";
    }
  }, [tiles, geom, params, link]);

  // --- бюджет на краях диапазона ПРД ---
  const linkLow = useMemo(() => {
    if (!geom || !params || freqMode !== "range" || !parsed.txFRangeValid)
      return null;
    try {
      return evaluateLink(tiles, geom, { ...params, fMHz: parsed.txFMin });
    } catch {
      return null;
    }
  }, [tiles, geom, params, freqMode, parsed.txFRangeValid, parsed.txFMin]);

  const linkHigh = useMemo(() => {
    if (!geom || !params || freqMode !== "range" || !parsed.txFRangeValid)
      return null;
    try {
      return evaluateLink(tiles, geom, { ...params, fMHz: parsed.txFMax });
    } catch {
      return null;
    }
  }, [tiles, geom, params, freqMode, parsed.txFRangeValid, parsed.txFMax]);

  // --- обратный канал (на частоте ПРМ) ---
  const linkReturn: LinkResult | null = useMemo(() => {
    if (!geom || !returnParams || freqMode !== "range" || !parsed.rxFRangeValid)
      return null;
    try {
      return evaluateLink(tiles, geom, returnParams);
    } catch {
      return null;
    }
  }, [tiles, geom, returnParams, freqMode, parsed.rxFRangeValid]);

  // --- бюджет на краях диапазона ПРМ ---
  const linkRxLow = useMemo(() => {
    if (!geom || !params || freqMode !== "range" || !parsed.rxFRangeValid)
      return null;
    try {
      return evaluateLink(tiles, geom, { ...params, fMHz: parsed.rxFMin });
    } catch {
      return null;
    }
  }, [tiles, geom, params, freqMode, parsed.rxFRangeValid, parsed.rxFMin]);

  const linkRxHigh = useMemo(() => {
    if (!geom || !params || freqMode !== "range" || !parsed.rxFRangeValid)
      return null;
    try {
      return evaluateLink(tiles, geom, { ...params, fMHz: parsed.rxFMax });
    } catch {
      return null;
    }
  }, [tiles, geom, params, freqMode, parsed.rxFRangeValid, parsed.rxFMax]);

  const required = useMemo(() => {
    return requiredTileNames(txWgs, rxWgs, radiusKm);
  }, [txWgs, rxWgs, radiusKm]);

  const txTileName = txWgs ? tileKeyAt(txWgs.lat, txWgs.lon) : null;
  const txTileReady =
    (txTileName !== null && tiles.has(txTileName)) || useSynthetic;

  const beamWidth = parsed.nums.beamWidthDeg ?? 0;

  // --- зона покрытия: тяжёлый скан после паузы ---
  useEffect(() => {
    if (!txWgs || !coverageParams || !txTileReady) {
      const reset = setTimeout(() => {
        setCoverage(null);
        setCoverageBusy(false);
      }, 0);
      return () => clearTimeout(reset);
    }
    const wgs = txWgs;
    const p = coverageParams;
    const t = tiles;
    const r = radiusKm;
    const timer = setTimeout(() => {
      setCoverageBusy(true);
      try {
        setCoverage(scanCoverage(t, wgs, p, r));
      } catch {
        setCoverage(null);
      }
      setCoverageBusy(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [txWgs, coverageParams, tiles, radiusKm, txTileReady]);

  // --- вертикальный анализ: уровень сигнала vs высота ПРМ ---
  useEffect(() => {
    const distKm = parseNum(values.vertDistKm ?? "");
    const azDeg = parseNum(values.vertAzDeg ?? "");
    if (
      !txWgs ||
      !params ||
      !txTileReady ||
      !Number.isFinite(distKm) ||
      distKm <= 0
    ) {
      const reset = setTimeout(() => {
        setVertical(null);
        setVerticalBusy(false);
      }, 0);
      return () => clearTimeout(reset);
    }
    const wgs = txWgs;
    const p = params;
    const t = tiles;
    const d = distKm;
    const az = azDeg;
    const mx = vertMaxHM;
    const timer = setTimeout(() => {
      setVerticalBusy(true);
      try {
        setVertical(verticalAnalysis(t, wgs, az, d, p, mx, Math.max(0.5, mx / 100)));
      } catch {
        setVertical(null);
      }
      setVerticalBusy(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [txWgs, params, tiles, txTileReady, values.vertDistKm, values.vertAzDeg, vertMaxHM]);

  // --- загрузка HGT ---
  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setReading(true);
    const errors: string[] = [];
    const next = new globalThis.Map(tiles);
    for (const file of Array.from(files)) {
      try {
        const buf = await file.arrayBuffer();
        const tile = parseHgt(file.name, buf);
        next.set(tile.name, tile);
        // Кэшируем тайл, чтобы он пережил перезагрузку страницы.
        try {
          await saveTile(tile.name, buf, tile.arcSec);
          setCacheCount((c) => c + 1);
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
    setTiles(next);
    setTileErrors(errors);
    setReading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const resetAll = () => {
    setValues(DEFAULTS);
    setCoordMode("deg");
    setPowerUnit("dBm");
    setFreqMode("single");
    setPolarization("V");
    setTileErrors([]);
  };

  const syncVertFromLink = () => {
    if (!geom) return;
    set("vertDistKm", String(Math.round((geom.distanceM / 1000) * 10) / 10));
    set("vertAzDeg", String(Math.round(geom.fwdAzDeg * 10) / 10));
  };

  // --- строки списка тайлов ---
  const tileRows = useMemo(() => {
    const rows: Array<{ name: string; role: string; present: boolean; info?: string }> = [];
    for (const name of required.path) {
      rows.push({ name, role: "трасса", present: tiles.has(name) });
    }
    for (const name of required.area) {
      rows.push({ name, role: "зона", present: tiles.has(name) });
    }
    const reqSet = new Set([...required.path, ...required.area]);
    for (const [name, t] of tiles) {
      if (!reqSet.has(name)) {
        rows.push({ name, role: "вне области", present: true, info: `${t.arcSec}″` });
      }
    }
    return rows;
  }, [required, tiles]);

  const missingCount = tileRows.filter((r) => !r.present).length;

  return (
    <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
      {/* ===================== Левая колонка: ввод ===================== */}
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTower className="h-4 w-4 text-muted-foreground" />
              Параметры радиолинии
            </CardTitle>
            <CardDescription>Модель потерь ITU-R P.525 / P.526</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-3 gap-y-4">
            {/* Режим частоты */}
            <div className="col-span-2">
              <Tabs
                value={freqMode}
                onValueChange={(v) => switchFreqMode(v as FreqMode)}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="single">Одна частота</TabsTrigger>
                  <TabsTrigger value="range">Диапазон ПРД/ПРМ</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Поля частоты */}
            {freqMode === "single" ? (
              <NumberField
                id="fMHz"
                label="Частота"
                unit="МГц"
                value={values.fMHz}
                onChange={(v) => set("fMHz", v)}
                invalid={parsed.bad.has("fMHz")}
                hint="от 50 до 7000"
              />
            ) : (
              <>
                <div className="col-span-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Диапазон частот ПРД
                </div>
                <NumberField
                  id="txFMinMHz"
                  label="Частота ПРД мин."
                  unit="МГц"
                  value={values.txFMinMHz ?? ""}
                  onChange={(v) => set("txFMinMHz", v)}
                  invalid={parsed.bad.has("txFMinMHz")}
                  hint="от 50"
                />
                <NumberField
                  id="txFMaxMHz"
                  label="Частота ПРД макс."
                  unit="МГц"
                  value={values.txFMaxMHz ?? ""}
                  onChange={(v) => set("txFMaxMHz", v)}
                  invalid={parsed.bad.has("txFMaxMHz")}
                  hint="до 7000, ≥ мин."
                />
                <div className="col-span-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Диапазон частот ПРМ
                </div>
                <NumberField
                  id="rxFMinMHz"
                  label="Частота ПРМ мин."
                  unit="МГц"
                  value={values.rxFMinMHz ?? ""}
                  onChange={(v) => set("rxFMinMHz", v)}
                  invalid={parsed.bad.has("rxFMinMHz")}
                  hint="от 50"
                />
                <NumberField
                  id="rxFMaxMHz"
                  label="Частота ПРМ макс."
                  unit="МГц"
                  value={values.rxFMaxMHz ?? ""}
                  onChange={(v) => set("rxFMaxMHz", v)}
                  invalid={parsed.bad.has("rxFMaxMHz")}
                  hint="до 7000, ≥ мин."
                />
              </>
            )}

            {/* Мощность ПРД с переключателем единиц */}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="pTxDbm" className="text-[13px]">
                Мощность ПРД
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="pTxDbm"
                    value={values.pTxDbm}
                    onChange={(e) => set("pTxDbm", e.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={parsed.bad.has("pTxDbm") || undefined}
                    className={cn(
                      "pr-12 tabular-nums",
                      parsed.bad.has("pTxDbm") &&
                        "border-destructive focus-visible:ring-destructive"
                    )}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                    {powerUnit === "dBm" ? "дБм" : "мВт"}
                  </span>
                </div>
                <Tabs
                  value={powerUnit}
                  onValueChange={(v) => switchPowerUnit(v as PowerUnit)}
                >
                  <TabsList className="h-9">
                    <TabsTrigger value="dBm">дБм</TabsTrigger>
                    <TabsTrigger value="mW">мВт</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {parsed.bad.has("pTxDbm") && (
                <p className="text-[11px] text-destructive">
                  {powerUnit === "dBm" ? "от −30 до 60" : "от 0,001 до 1 000 000"}
                </p>
              )}
            </div>

            {/* Остальные параметры (без fMHz) */}
            {RADIO_FIELDS.filter((f) => f.key !== "fMHz").map((f) => (
              <NumberField
                key={f.key}
                id={f.key}
                label={f.label}
                unit={f.unit}
                value={values[f.key] ?? ""}
                onChange={(v) => set(f.key, v)}
                invalid={parsed.bad.has(f.key)}
                hint={f.hint}
                className={
                  f.key === "txAntHM" ||
                  f.key === "rxAntHM" ||
                  f.key === "kFactor"
                    ? "col-span-2"
                    : undefined
                }
              />
            ))}

            {/* Ширина луча (опционально) */}
            <NumberField
              id="beamWidthDeg"
              label="Ширина луча (опц.)"
              unit="°"
              value={values.beamWidthDeg ?? ""}
              onChange={(v) => set("beamWidthDeg", v)}
              invalid={parsed.bad.has("beamWidthDeg")}
              hint="0 — ненаправленная"
            />

            {/* Поляризация */}
            <div className="space-y-1.5">
              <Label className="text-[13px]">Поляризация</Label>
              <Select
                value={polarization}
                onValueChange={(v) => setPolarization(v as Polarization)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="V">Вертикальная</SelectItem>
                  <SelectItem value="H">Горизонтальная</SelectItem>
                  <SelectItem value="C">Круговая</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={resetAll}
              className="col-span-2 mt-1"
            >
              Сбросить значения
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Координаты, СК-42</CardTitle>
            <CardDescription>
              Эллипсоид Красовского; переход в WGS-84 по ГОСТ Р 51794-2008.
              Обе точки — приёмопередатчики (полный дуплексный обмен). Станция B опциональна — без неё строится только зона связи вокруг A.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs
              value={coordMode}
              onValueChange={(v) => setCoordMode(v as CoordMode)}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="deg">Градусы B, L</TabsTrigger>
                <TabsTrigger value="gk">Метры X, Y (ГК)</TabsTrigger>
              </TabsList>
            </Tabs>

            {coordMode === "deg" ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                <NumberField
                  id="txB"
                  label="Станция A: широта B"
                  unit="°"
                  value={values.txB}
                  onChange={(v) => set("txB", v)}
                  invalid={points.bad.has("txB")}
                  hint="−90…90"
                />
                <NumberField
                  id="txL"
                  label="Станция A: долгота L"
                  unit="°"
                  value={values.txL}
                  onChange={(v) => set("txL", v)}
                  invalid={points.bad.has("txL")}
                  hint="−180…180"
                />
                <NumberField
                  id="rxB"
                  label="Станция B: широта B (опц.)"
                  unit="°"
                  value={values.rxB}
                  onChange={(v) => set("rxB", v)}
                  invalid={points.bad.has("rxB")}
                  hint="−90…90"
                />
                <NumberField
                  id="rxL"
                  label="Станция B: долгота L (опц.)"
                  unit="°"
                  value={values.rxL}
                  onChange={(v) => set("rxL", v)}
                  invalid={points.bad.has("rxL")}
                  hint="−180…180"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                <NumberField
                  id="txX"
                  label="ПРД: X (от экватора)"
                  unit="м"
                  value={values.txX}
                  onChange={(v) => set("txX", v)}
                  invalid={points.bad.has("txX")}
                />
                <NumberField
                  id="txY"
                  label="ПРД: Y (X + зона·10⁶)"
                  unit="м"
                  value={values.txY}
                  onChange={(v) => set("txY", v)}
                  invalid={points.bad.has("txY")}
                />
                <NumberField
                  id="rxX"
                  label="ПРМ: X (опц.)"
                  unit="м"
                  value={values.rxX}
                  onChange={(v) => set("rxX", v)}
                  invalid={points.bad.has("rxX")}
                />
                <NumberField
                  id="rxY"
                  label="ПРМ: Y (опц.)"
                  unit="м"
                  value={values.rxY}
                  onChange={(v) => set("rxY", v)}
                  invalid={points.bad.has("rxY")}
                />
              </div>
            )}

            {txWgs && (
              <dl className="space-y-1 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">ПРД, WGS-84</dt>
                  <dd className="tabular-nums">
                    {fmtDms(txWgs.lat, "lat")} {fmtDms(txWgs.lon, "lon")}
                  </dd>
                </div>
                {rxWgs && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">ПРМ, WGS-84</dt>
                    <dd className="tabular-nums">
                      {fmtDms(rxWgs.lat, "lat")} {fmtDms(rxWgs.lon, "lon")}
                    </dd>
                  </div>
                )}
                {points.txGk && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">ПРД, Гаусс–Крюгер</dt>
                    <dd className="tabular-nums">
                      X {fmt(points.txGk.x, 0)}, Y {fmt(points.txGk.y, 0)}
                    </dd>
                  </div>
                )}
                {points.rxGk && rxOk && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">ПРМ, Гаусс–Крюгер</dt>
                    <dd className="tabular-nums">
                      X {fmt(points.rxGk.x, 0)}, Y {fmt(points.rxGk.y, 0)}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </CardContent>
        </Card>

        {/* --- Карта выбора точек --- */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <LucideMap className="h-4 w-4 text-muted-foreground" />
              Карта
            </CardTitle>
            <CardDescription>
              Кликните на карте, чтобы задать точку ПРД или ПРМ.
              Координаты пересчитываются в СК-42 автоматически.
              Слои: Google Схема / Спутник / Гибрид.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MapPicker
              tx={txWgs}
              rx={rxWgs}
              trajectory={
                trajectoryResult
                  ? trajectoryResult.points.map((p) => ({
                      lat: p.lat,
                      lon: p.lon,
                      status: p.status,
                    }))
                  : trajectory
                    ? trajectory.points.map((p) => ({
                        lat: p.lat,
                        lon: p.lon,
                        status: null,
                      }))
                    : undefined
              }
              pickMode={pickMode}
              onPick={handleMapPick}
              onChangePickMode={() =>
                setPickMode((m) => (m === "tx" ? "rx" : "tx"))
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mountain className="h-4 w-4 text-muted-foreground" />
              Рельеф (файлы HGT)
            </CardTitle>
            <CardDescription>
              SRTM 3″ или 1″; имя тайла — юго-западный угол, например N55E037.hgt
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept=".hgt"
              multiple
              className="hidden"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <Button
              variant="outline"
              className="w-full"
              disabled={reading}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              {reading ? "Чтение файлов…" : "Загрузить файлы .hgt"}
            </Button>

            <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={useSynthetic}
                onChange={(e) => setUseSynthetic(e.target.checked)}
              />
              <span>
                <span className="font-medium">Синтетический рельеф</span>
                <span className="block text-xs text-muted-foreground">
                  Демо-режим без HGT (из Grok_freqcalc). Не для ответственных расчётов.
                </span>
              </span>
            </label>

            {tileErrors.length > 0 && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Файлы не приняты</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {tileErrors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {tileRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Загрузите тайлы, покрывающие трассу и зону анализа — список появится здесь.
              </p>
            ) : (
              <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                {tileRows.map((r) => (
                  <div
                    key={r.name}
                    className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs"
                  >
                    <span className="font-mono font-medium">{r.name}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{r.info ?? r.role}</span>
                      {r.present ? (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          есть
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                          нет
                        </Badge>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {tileRows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {missingCount === 0
                  ? `Все нужные тайлы загружены (${tileRows.length} шт.).`
                  : `Не хватает файлов: ${missingCount}.`}
              </p>
            )}

            {/* --- Кэш тайлов в IndexedDB --- */}
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">Кэш браузера</span>
                  {cacheLoading ? (
                    <span className="text-muted-foreground">чтение…</span>
                  ) : (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {cacheCount > 0
                        ? `${cacheCount} ${cacheCount === 1 ? "тайл" : cacheCount < 5 ? "тайла" : "тайлов"}`
                        : "пусто"}
                    </Badge>
                  )}
                </div>
                {cacheCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={async () => {
                      try {
                        await clearAllTiles();
                      } catch {
                        // IndexedDB недоступен
                      }
                      setCacheCount(0);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Очистить
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Загруженные тайлы сохраняются в браузере (IndexedDB) и восстанавливаются
                автоматически при перезагрузке страницы.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===================== Правая колонка: результаты ===================== */}
      <div className="space-y-6">
        {/* --- Зона связи --- */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Зона двусторонней связи вокруг станции A</CardTitle>
                <CardDescription>
                  Центр — передатчик; север сверху; граница = запас на входе ПРМ ≥{" "}
                  {params ? fmt(params.fadeMarginDb, 0) : "—"} дБ
                  {freqMode === "range" && parsed.txFRangeValid
                    ? `; частота ${fmt(parsed.txFMax, 0)} МГц (худший случай)`
                    : ""}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Радиус анализа</span>
                <Select
                  value={String(radiusKm)}
                  onValueChange={(v) => setRadiusKm(Number(v))}
                >
                  <SelectTrigger className="h-8 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANALYSIS_KM.map((km) => (
                      <SelectItem key={km} value={String(km)}>
                        {km} км
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!txOk || !params ? (
              <Placeholder text="Введите корректные координаты ПРД и параметры — диаграмма построится автоматически." />
            ) : !txTileReady ? (
              <Placeholder
                text={`Нужен файл ${txTileName}.hgt — рельеф в точке передатчика. Загрузите его в панели «Рельеф».`}
                warning
              />
            ) : coverageBusy && !coverage ? (
              <Placeholder text="Расчёт зоны покрытия…" />
            ) : coverage ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_190px]">
                <CoverageChart
                  coverage={coverage}
                  geom={geom}
                  beamWidthDeg={beamWidth}
                  className="mx-auto w-full max-w-[460px] text-foreground"
                />
                <dl className="space-y-2.5 self-center text-sm">
                  <Metric label="Площадь зоны" value={`${fmt(coverage.areaKm2, 1)} км²`} />
                  <Metric
                    label="Лучший азимут"
                    value={`${fmt(coverage.bestAz, 0)}° — ${fmt(coverage.bestKm, 1)} км`}
                  />
                  <Metric
                    label="Худший азимут"
                    value={`${fmt(coverage.worstAz, 0)}° — ${fmt(coverage.worstKm, 1)} км`}
                  />
                  {coverage.limitHits > 0 && (
                    <Metric
                      label="Упёрлись в радиус анализа"
                      value={`${coverage.limitHits} из 72`}
                    />
                  )}
                  {coverage.dataHits > 0 && (
                    <Metric label="Без данных HGT" value={`${coverage.dataHits} из 72`} />
                  )}
                  {beamWidth > 0 && beamWidth < 360 && (
                    <Metric label="Ширина луча" value={`${fmt(beamWidth, 0)}°`} />
                  )}
                  <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                    {rxOk
                      ? "Пунктир — линия на ПРМ; сплошной кружок — приёмник."
                      : "Без координат ПРМ — только зона вокруг передатчика."}
                  </p>
                </dl>
              </div>
            ) : (
              <Placeholder text="Зона покрытия не рассчитана." warning />
            )}
          </CardContent>
        </Card>

        {/* --- Профиль трассы --- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Профиль трассы A ↔ B (приёмопередатчики)</CardTitle>
            <CardDescription>
              {!rxOk
                ? "Укажите координаты ПРМ для построения профиля"
                : "Рельеф с учётом кривизны Земли (k), линия визирования и первая зона Френеля"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {link ? (
              <ProfileChart link={link} fadeMarginDb={params?.fadeMarginDb ?? 0} className="w-full text-foreground" />
            ) : linkError ? (
              <Placeholder text={linkError} warning />
            ) : !rxOk ? (
              <Placeholder text="Координаты ПРМ не указаны — профиль не строится. Зона связи доступна." />
            ) : (
              <Placeholder text="Исправьте координаты или параметры, чтобы построить профиль." />
            )}
          </CardContent>
        </Card>

        {/* --- Бюджет линии --- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Бюджет двусторонней линии A ↔ B</CardTitle>
          </CardHeader>
          <CardContent>
            {link ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const q = signalQuality(
                      link.marginDb,
                      params?.fadeMarginDb ?? 0
                    );
                    const style = {
                      backgroundColor: SIGNAL_COLORS[q],
                      color: "#fff",
                      borderColor: SIGNAL_COLORS[q],
                    };
                    return (
                      <Badge style={style}>
                        {SIGNAL_LABELS[q]}
                      </Badge>
                    );
                  })()}
                  <Badge variant="outline">
                    {fmt(link.distanceM / 1000, 2)} км
                  </Badge>
                  <Badge variant="outline">
                    аз. {fmt(link.geom.fwdAzDeg, 1)}° (ист.) / {fmt(link.geom.revAzDeg, 1)}° (обр.)
                  </Badge>
                  <Badge variant="outline">
                    дир. угол {fmt(link.geom.gridAzDeg, 1)}°, зона {link.geom.zone}
                  </Badge>
                  <Badge variant="outline">{POL_LABEL[polarization]}</Badge>
                </div>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <Metric
                    label="EIRP"
                    value={`${fmt(link.eirpDbm, 1)} дБм`}
                  />
                  <Metric
                    label="Базовые потери (P.525)"
                    value={`${fmt(link.fspl, 1)} дБ`}
                  />
                  <Metric
                    label="Дифракция (P.526)"
                    value={
                      link.diff.loss > 0.05
                        ? `${fmt(link.diff.loss, 1)} дБ — ${
                            link.diff.method === "deygout"
                              ? "Дейгаут"
                              : link.diff.method === "bullington"
                                ? "Буллингтон"
                                : "нет"
                          }`
                        : "нет препятствий"
                    }
                  />
                  <Metric
                    label="Уровень на входе ПРМ"
                    value={`${fmt(link.prxDbm, 1)} дБм`}
                  />
                  <Metric
                    label="Запас относительно чувствительности"
                    value={`${fmt(link.marginDb, 1)} дБ (нужно ${fmt(params?.fadeMarginDb ?? 0, 0)})`}
                  />
                  <Metric
                    label="Высоты антенн над уровнем моря"
                    value={`${fmt(link.h1AbsM, 0)} / ${fmt(link.h2AbsM, 0)} м`}
                  />
                  <Metric
                    label="Рельеф в точках ПРД / ПРМ"
                    value={`${fmt(link.txTerrainM, 0)} / ${fmt(link.rxTerrainM, 0)} м`}
                  />
                  <Metric
                    label="Радиус Френеля в середине"
                    value={`${fmt(link.f1MidM, 1)} м`}
                  />
                  <Metric
                    label="Худший просвет / радиус Френеля"
                    value={
                      Number.isFinite(link.minClearance)
                        ? fmt(link.minClearance, 2)
                        : "—"
                    }
                  />
                  <Metric
                    label="Пробелы данных HGT"
                    value={
                      link.gapCount === 0
                        ? "нет"
                        : `${link.gapCount} отсч. (${fmt(link.gapRatio * 100, 0)}%)`
                    }
                  />
                  <Metric
                    label="Рельеф"
                    value={useSynthetic && tiles.size === 0 ? "синтетический (демо)" : "HGT/SRTM"}
                  />
                </dl>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!link || !params) return;
                      const payload = {
                        exported_at: new Date().toISOString(),
                        params,
                        useSynthetic,
                        result: {
                          distance_km: link.distanceM / 1000,
                          fspl_db: link.fspl,
                          diffraction_db: link.diff.loss,
                          diffraction_method: link.diff.method,
                          prx_dbm: link.prxDbm,
                          margin_db: link.marginDb,
                          ok: link.ok,
                          az_fwd_deg: link.geom.fwdAzDeg,
                          az_rev_deg: link.geom.revAzDeg,
                        },
                      };
                      const blob = new Blob([JSON.stringify(payload, null, 2)], {
                        type: "application/json",
                      });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = "radio_link.json";
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    Экспорт JSON
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!link) return;
                      const rows = [
                        "metric,value",
                        `distance_km,${(link.distanceM / 1000).toFixed(3)}`,
                        `fspl_db,${link.fspl.toFixed(2)}`,
                        `diffraction_db,${link.diff.loss.toFixed(2)}`,
                        `diffraction_method,${link.diff.method}`,
                        `prx_dbm,${link.prxDbm.toFixed(2)}`,
                        `margin_db,${link.marginDb.toFixed(2)}`,
                        `ok,${link.ok}`,
                      ];
                      if (freqMode === "range" && geom && params) {
                        const sweep = frequencySweep(
                          tiles,
                          geom,
                          params,
                          parsed.txFMin,
                          parsed.txFMax,
                          Math.max((parsed.txFMax - parsed.txFMin) / 20, 0.1)
                        );
                        rows.push("", "freq_mhz,path_loss_db,prx_dbm,margin_db");
                        for (const s of sweep) {
                          rows.push(
                            `${s.freq_mhz},${s.path_loss_db},${s.prx_dbm},${s.margin_db}`
                          );
                        }
                      }
                      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = "radio_link.csv";
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    Экспорт CSV
                  </Button>
                </div>

                {/* Сравнение на краях диапазонов ПРД и ПРМ */}
                {freqMode === "range" &&
                  (parsed.txFRangeValid || parsed.rxFRangeValid) && (
                    <div className="rounded-lg bg-muted/50 p-3 text-xs">
                      {parsed.txFRangeValid && linkLow && linkHigh && (
                        <>
                          <p className="mb-2 font-medium">
                            Диапазон ПРД {fmt(parsed.txFMin, 0)}–{fmt(parsed.txFMax, 0)} МГц:
                          </p>
                          <table className="w-full tabular-nums">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="pb-1 text-left font-normal">Частота</th>
                                <th className="pb-1 text-right font-normal">FSPL</th>
                                <th className="pb-1 text-right font-normal">Дифр.</th>
                                <th className="pb-1 text-right font-normal">ПРМ</th>
                                <th className="pb-1 text-right font-normal">Запас</th>
                              </tr>
                            </thead>
                            <tbody>
                              <RangeRow fMHz={parsed.txFMin} link={linkLow} fade={params?.fadeMarginDb ?? 0} />
                              <RangeRow fMHz={link.fMHz} link={link} fade={params?.fadeMarginDb ?? 0} />
                              <RangeRow fMHz={parsed.txFMax} link={linkHigh} fade={params?.fadeMarginDb ?? 0} />
                            </tbody>
                          </table>
                        </>
                      )}
                      {parsed.rxFRangeValid && linkRxLow && linkRxHigh && (
                        <>
                          <p
                            className={`mb-2 font-medium ${
                              parsed.txFRangeValid && linkLow && linkHigh ? "mt-3" : ""
                            }`}
                          >
                            Диапазон ПРМ {fmt(parsed.rxFMin, 0)}–{fmt(parsed.rxFMax, 0)} МГц
                            (обратный канал):
                          </p>
                          <table className="w-full tabular-nums">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="pb-1 text-left font-normal">Частота</th>
                                <th className="pb-1 text-right font-normal">FSPL</th>
                                <th className="pb-1 text-right font-normal">Дифр.</th>
                                <th className="pb-1 text-right font-normal">ПРМ</th>
                                <th className="pb-1 text-right font-normal">Запас</th>
                              </tr>
                            </thead>
                            <tbody>
                              <RangeRow fMHz={parsed.rxFMin} link={linkRxLow} fade={params?.fadeMarginDb ?? 0} />
                              {linkReturn && (
                                <RangeRow fMHz={linkReturn.fMHz} link={linkReturn} fade={params?.fadeMarginDb ?? 0} />
                              )}
                              <RangeRow fMHz={parsed.rxFMax} link={linkRxHigh} fade={params?.fadeMarginDb ?? 0} />
                            </tbody>
                          </table>
                        </>
                      )}
                    </div>
                  )}

                {link.obstacles.length > 0 && (
                  <div className="rounded-lg bg-muted/50 p-3 text-xs">
                    <p className="mb-1 font-medium">Препятствия над линией визирования (v &gt; 0):</p>
                    <ul className="space-y-0.5 text-muted-foreground">
                      {link.obstacles.map((o, i) => (
                        <li key={i}>
                          {fmt(o.dM / 1000, 1)} км от ПРД, высота {fmt(o.hM, 0)} м, v = {fmt(o.v, 2)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : !rxOk ? (
              <Placeholder text="Укажите координаты ПРМ для расчёта бюджета линии." />
            ) : (
              <Placeholder text="Бюджет появится после устранения ошибок ввода и загрузки рельефа." />
            )}
          </CardContent>
        </Card>

        {/* --- Траектория движения ПРМ --- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Route className="h-4 w-4 text-muted-foreground" />
              Траектория ПРМ
            </CardTitle>
            <CardDescription>
              Загрузите файл траектории (.rt) для расчёта радиолинии ПРД → ПРМ
              в каждой точке.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={trajFileRef}
              type="file"
              accept=".rt,application/json"
              className="hidden"
              onChange={(e) => handleTrajectoryFile(e.target.files)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => trajFileRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                {trajectory ? "Заменить .rt" : "Загрузить .rt"}
              </Button>
              {trajectory && (
                <>
                  <Badge variant="secondary" className="px-2 py-0 text-[11px]">
                    {trajectory.fileName} ({trajectory.points.length} точек)
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-destructive"
                    onClick={clearTrajectory}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Очистить
                  </Button>
                </>
              )}
            </div>

            {trajectoryWarnings.length > 0 && (
              <Alert>
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Предупреждения</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs">
                    {trajectoryWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {trajectoryError && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Ошибка</AlertTitle>
                <AlertDescription className="text-xs">
                  {trajectoryError}
                </AlertDescription>
              </Alert>
            )}

            {trajectoryBusy && <Placeholder text="Расчёт траектории…" />}

            {trajectoryResult && (
              <div className="space-y-3">
                {/* Сводка */}
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant={
                      trajectoryResult.okCount > 0 ? "default" : "destructive"
                    }
                    className="px-2 py-0 text-[11px]"
                  >
                    Связь: {trajectoryResult.okCount} из{" "}
                    {trajectoryResult.points.length}
                  </Badge>
                  {trajectoryResult.dataCount > 0 && (
                    <Badge variant="secondary" className="px-2 py-0 text-[11px]">
                      Нет HGT: {trajectoryResult.dataCount}
                    </Badge>
                  )}
                  {trajectoryResult.errorCount > 0 && (
                    <Badge variant="destructive" className="px-2 py-0 text-[11px]">
                      Ошибок: {trajectoryResult.errorCount}
                    </Badge>
                  )}
                  {trajectory?.tripodHeightM !== null &&
                    trajectory?.tripodHeightM !== undefined && (
                      <Badge variant="outline" className="px-2 py-0 text-[11px]">
                        Штатив: {fmt(trajectory.tripodHeightM, 0)} м
                      </Badge>
                    )}
                </div>

                {/* Таблица точек */}
                <div className="max-h-64 overflow-y-auto rounded-lg border text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                        <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">
                          №
                        </th>
                        <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">
                          Широта
                        </th>
                        <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">
                          Долгота
                        </th>
                        <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">
                          Дальн.
                        </th>
                        <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">
                          Запас
                        </th>
                        <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">
                          Ст.
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {trajectoryResult.points.map((p) => (
                        <tr
                          key={p.idx}
                          className={cn(
                            "border-b border-border/40",
                            p.ok
                              ? ""
                              : p.status === "error"
                                ? "bg-destructive/5"
                                : "bg-muted/20"
                          )}
                        >
                          <td className="px-2 py-1 font-mono">{p.idx + 1}</td>
                          <td className="px-2 py-1 tabular-nums">
                            {fmt(p.lat, 4)}°
                          </td>
                          <td className="px-2 py-1 tabular-nums">
                            {fmt(p.lon, 4)}°
                          </td>
                          <td className="px-2 py-1 tabular-nums">
                            {fmt(p.distanceM / 1000, 2)} км
                          </td>
                          <td
                            className={cn(
                              "px-2 py-1 tabular-nums font-medium",
                              p.marginDb !== null && p.marginDb >= 0
                                ? "text-green-600"
                                : "text-destructive"
                            )}
                          >
                            {p.marginDb !== null
                              ? fmt(p.marginDb, 1)
                              : "—"}
                          </td>
                          <td className="px-2 py-1">
                            <span
                              className={cn(
                                "inline-block h-2 w-2 rounded-full",
                                p.status === "ok"
                                  ? "bg-green-600"
                                  : p.status === "data"
                                    ? "bg-gray-400"
                                    : "bg-red-600"
                              )}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Статистика */}
                {trajectoryResult.points.length > 0 &&
                  (trajectoryResult.bestIdx !== null ||
                    trajectoryResult.worstIdx !== null) && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      {trajectoryResult.bestIdx !== null && (
                        <Metric
                          label="Макс. запас"
                          value={`${fmt(trajectoryResult.points[trajectoryResult.bestIdx].marginDb ?? 0, 1)} дБ (точка ${trajectoryResult.bestIdx + 1})`}
                        />
                      )}
                      {trajectoryResult.worstIdx !== null && (
                        <Metric
                          label="Мин. запас"
                          value={`${fmt(trajectoryResult.points[trajectoryResult.worstIdx].marginDb ?? 0, 1)} дБ (точка ${trajectoryResult.worstIdx + 1})`}
                        />
                      )}
                    </dl>
                  )}
              </div>
            )}

            {!trajectory && !trajectoryBusy && !trajectoryError && (
              <Placeholder text="Загрузите файл траектории .rt (JSON-формат). Траектория отобразится на карте, а расчёт выполнится по всем точкам." />
            )}
          </CardContent>
        </Card>

        {/* --- Вертикальный анализ --- */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                  Сигнал по высоте ПРМ
                </CardTitle>
                <CardDescription>
                  Уровень на входе ПРМ в зависимости от высоты антенны над рельефом
                </CardDescription>
              </div>
              {geom && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={syncVertFromLink}
                  className="h-8 shrink-0"
                >
                  <Compass className="h-3.5 w-3.5" />
                  от трассы
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-[1fr_1fr_auto]">
              <NumberField
                id="vertDistKm"
                label="Дальность"
                unit="км"
                value={values.vertDistKm ?? ""}
                onChange={(v) => set("vertDistKm", v)}
                hint="от 0,1"
              />
              <NumberField
                id="vertAzDeg"
                label="Азимут"
                unit="°"
                value={values.vertAzDeg ?? ""}
                onChange={(v) => set("vertAzDeg", v)}
                hint="0…360"
              />
              <div className="space-y-1.5">
                <Label className="text-[13px]">До высоты</Label>
                <Select
                  value={String(vertMaxHM)}
                  onValueChange={(v) => setVertMaxHM(Number(v))}
                >
                  <SelectTrigger className="h-9 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[25, 50, 100, 200].map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h} м
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!txOk || !params ? (
              <Placeholder text="Введите координаты ПРД и параметры — график построится автоматически." />
            ) : !txTileReady ? (
              <Placeholder
                text={`Нужен файл ${txTileName}.hgt — рельеф в точке передатчика.`}
                warning
              />
            ) : verticalBusy && !vertical ? (
              <Placeholder text="Расчёт вертикального профиля…" />
            ) : vertical ? (
              <div className="space-y-3">
                <VerticalChart
                  result={vertical}
                  fadeMarginDb={params?.fadeMarginDb ?? 0}
                  className="w-full text-foreground"
                />
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <Metric
                    label="Мин. высота устойчивой связи"
                    value={
                      vertical.minHeightM !== null
                        ? `${fmt(vertical.minHeightM, 1)} м`
                        : "нет во всём диапазоне"
                    }
                  />
                  <Metric
                    label="Порог (чувств. + запас)"
                    value={`${fmt(vertical.thresholdDbm, 0)} дБм`}
                  />
                  <Metric
                    label="Макс. уровень ПРМ"
                    value={`${fmt(vertical.prxMaxDbm, 1)} дБм`}
                  />
                  <Metric
                    label="Мин. уровень ПРМ"
                    value={`${fmt(vertical.prxMinDbm, 1)} дБм`}
                  />
                  <Metric
                    label="Точка анализа"
                    value={`${fmt(vertical.distanceKm, 1)} км, аз. ${fmt(vertical.azDeg, 0)}°`}
                  />
                  <Metric
                    label="Рельеф в точке анализа"
                    value={`${fmt(vertical.terrainM, 0)} м`}
                  />
                </dl>
                {vertical.minHeightM === null && (
                  <p className="text-xs text-destructive">
                    На указанной дальности связь не обеспечивается ни на одной
                    высоте до {fmt(vertMaxHM, 0)} м — увеличьте мощность,
                    усиление антенн или поднимите антенну ПРД.
                  </p>
                )}
              </div>
            ) : (
              <Placeholder text="График появится после устранения ошибок." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RangeRow({
  fMHz,
  link,
  fade,
}: {
  fMHz: number;
  link: LinkResult;
  fade: number;
}) {
  return (
    <tr className="border-t border-border/40">
      <td className="py-1">{fmt(fMHz, 0)} МГц</td>
      <td className="py-1 text-right">{fmt(link.fspl, 1)}</td>
      <td className="py-1 text-right">{fmt(link.diff.loss, 1)}</td>
      <td className="py-1 text-right">{fmt(link.prxDbm, 1)}</td>
      <td
        className={cn(
          "py-1 text-right font-medium",
          link.marginDb >= fade ? "text-foreground" : "text-destructive"
        )}
      >
        {fmt(link.marginDb, 1)}
      </td>
    </tr>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Placeholder({ text, warning }: { text: string; warning?: boolean }) {
  return (
    <div className="flex min-h-52 items-center justify-center rounded-lg border border-dashed p-6 text-center">
      <p className={`max-w-sm text-sm ${warning ? "text-destructive" : "text-muted-foreground"}`}>
        {text}
      </p>
    </div>
  );
}
