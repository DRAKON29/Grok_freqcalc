// Тесты фазы 2.3: адаптивный скан покрытия (экспоненциальный поиск + бисекция
// + skip-оптимизация по азимуту) должен давать результат, эквивалентный
// исходному brute-force скану по лестнице дальностей.

import { describe, expect, it } from "vitest";
import {
  RadioParams,
  scanCoverage,
  evaluatePoint,
} from "@/lib/radio/engine";
import { DEFAULT_HELMERT_SK42_WGS84 } from "@/lib/radio/sk42";
import { makeFlatTile, tileMap } from "./helpers/fixtures";

const params: RadioParams = {
  fMHz: 433,
  pTxDbm: 37,
  txGainDbi: 6,
  rxGainDbi: 6,
  txFeederDb: 1,
  rxFeederDb: 1,
  extraLossDb: 0,
  txAntHM: 10,
  rxAntHM: 10,
  sensitivityDbm: -101,
  fadeMarginDb: 10,
  kFactor: 4 / 3,
  helm: DEFAULT_HELMERT_SK42_WGS84,
};

// TX в центре плоского поля HGT (тайлы покрывают ~±1° ≈ ±111 км).
const TX = { lat: 47.5, lon: 39.5 };

const flatTiles = tileMap([
  makeFlatTile(46, 38, 100),
  makeFlatTile(46, 39, 100),
  makeFlatTile(46, 40, 100),
  makeFlatTile(47, 38, 100),
  makeFlatTile(47, 39, 100),
  makeFlatTile(47, 40, 100),
  makeFlatTile(48, 38, 100),
  makeFlatTile(48, 39, 100),
  makeFlatTile(48, 40, 100),
]);

/** Эталон (brute-force): лестница + бисекция — как было до фазы 2.3. */
function referenceScan(analysisKm: number) {
  const ladderKm: number[] = [];
  for (let km = 0.5; km < analysisKm; km *= 1.8) ladderKm.push(km);
  ladderKm.push(analysisKm);

  const marginAt = (azRad: number, km: number) =>
    evaluatePoint(flatTiles, TX, azRad, km * 1000, params);

  const rays = [];
  for (let az = 0; az < 360; az += 5) {
    const azRad = (az * Math.PI) / 180;
    let lastGood = 0;
    let failGood: number | null = null;
    let lastWeak = 0;
    let failWeak: number | null = null;
    let dataFail: number | null = null;
    for (const km of ladderKm) {
      const m = marginAt(azRad, km);
      if (!m.dataOk) {
        dataFail = km;
        break;
      }
      if (m.margin >= params.fadeMarginDb) {
        lastGood = km;
        lastWeak = km;
      } else if (m.margin >= 0) {
        lastWeak = km;
        if (failGood === null) failGood = km;
      } else {
        if (failGood === null) failGood = km;
        if (failWeak === null) failWeak = km;
        break;
      }
    }
    let km = lastGood;
    let kmWeak = lastWeak;
    const bisect = (lo: number, hi: number, minMargin: number) => {
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        const m = marginAt(azRad, mid);
        if (m.dataOk && m.margin >= minMargin) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    if (failGood !== null && lastGood < failGood) {
      km = bisect(lastGood, failGood, params.fadeMarginDb);
    }
    if (failWeak !== null && lastWeak < failWeak) {
      kmWeak = bisect(lastWeak, failWeak, 0);
    }
    let status: "ok" | "data" | "limit" = "ok";
    if (dataFail !== null) status = "data";
    else if (failGood === null) {
      status = "limit";
      km = analysisKm;
      kmWeak = analysisKm;
    }
    if (status === "data" && lastGood === 0 && lastWeak === 0) {
      km = 0;
      kmWeak = 0;
    }
    rays.push({ azDeg: az, km, kmWeak, status });
  }
  return rays;
}

describe("scanCoverage — адаптивный скан (фаза 2.3)", () => {
  it("возвращает ровно 72 луча с шагом 5°, без undefined", () => {
    const cov = scanCoverage(flatTiles, TX, params, 30);
    expect(cov.rays.length).toBe(72);
    cov.rays.forEach((r, i) => {
      expect(r).toBeDefined();
      expect(r.azDeg).toBe(i * 5);
      expect(Number.isFinite(r.km)).toBe(true);
      expect(r.kmWeak).toBeGreaterThanOrEqual(r.km);
    });
  });

  it("плоский рельеф: все лучи limit, границы равны радиусу анализа", () => {
    // FSPL на 30 км/433 МГц ≈ 112 дБ → EIRP+G−FSPL−L ≈ −71 дБм, запас ≫ fade
    const cov = scanCoverage(flatTiles, TX, params, 30);
    expect(cov.limitHits).toBe(72);
    expect(cov.dataHits).toBe(0);
    for (const r of cov.rays) {
      expect(r.status).toBe("limit");
      expect(r.km).toBeCloseTo(30, 5);
      expect(r.kmWeak).toBeCloseTo(30, 5);
    }
    expect(cov.bestKm).toBeCloseTo(30, 5);
    expect(cov.worstKm).toBeCloseTo(30, 5);
    expect(cov.areaKm2).toBeCloseTo(Math.PI * 30 * 30, 0);
  });

  it("эквивалентен эталонному brute-force скану (границы ±100 м)", () => {
    const adaptive = scanCoverage(flatTiles, TX, params, 25);
    const reference = referenceScan(25);
    expect(adaptive.rays.length).toBe(reference.length);
    for (let i = 0; i < reference.length; i++) {
      const a = adaptive.rays[i];
      const r = reference[i];
      expect(a.status).toBe(r.status);
      // граница зелёной зоны: не точнее разрешения бисекции эталона, но близко
      expect(Math.abs(a.km - r.km) * 1000).toBeLessThan(100);
      expect(Math.abs(a.kmWeak - r.kmWeak) * 1000).toBeLessThan(100);
    }
  });

  it("луч за пределами данных HGT: статус data и dataHits > 0", () => {
    // только один тайл вокруг TX — на восток/запад упрёмся в край данных
    const oneTile = tileMap([makeFlatTile(47, 39, 100)]);
    const txIn = { lat: 47.5, lon: 39.5 };
    const cov = scanCoverage(oneTile, txIn, params, 200);
    expect(cov.dataHits).toBeGreaterThan(0);
    for (const r of cov.rays) {
      if (r.status === "data") {
        expect(r.km).toBeLessThanOrEqual(200);
      }
    }
  });

  it("детерминирован: повторный вызов даёт идентичный результат", () => {
    const a = scanCoverage(flatTiles, TX, params, 30);
    const b = scanCoverage(flatTiles, TX, params, 30);
    expect(a).toEqual(b);
  });

  it("малый радиус анализа (< первой ступени 0.5 км) обрабатывается", () => {
    const cov = scanCoverage(flatTiles, TX, params, 0.3);
    expect(cov.rays.length).toBe(72);
    for (const r of cov.rays) {
      expect(r.status).toBe("limit");
      expect(r.km).toBeCloseTo(0.3, 5);
    }
  });
});
