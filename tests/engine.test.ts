// Сквозные детерминированные тесты движка: геометрия трассы, бюджет линии,
// дифракция на реальном профиле HGT, краевые ошибки.

import { describe, expect, it } from "vitest";
import {
  RadioParams,
  evaluateLink,
  pathGeometry,
} from "@/lib/radio/engine";
import { fsplDb } from "@/lib/radio/pathloss";
import { DEFAULT_HELMERT_SK42_WGS84, zoneForLon } from "@/lib/radio/sk42";
import { makeFlatTile, tileMap } from "./helpers/fixtures";

const params: RadioParams = {
  fMHz: 433,
  pTxDbm: 37, // ~5 Вт
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

// Точки в СК-42 около 47° с.ш., 39–40° в.д.: трасса ~22 км внутри тайла N47E039.
const TX = { B: 47.3, L: 39.3 };
const RX = { B: 47.3, L: 39.6 };

describe("pathGeometry", () => {
  it("считает расстояние и азимуты согласованно", () => {
    const g = pathGeometry(TX, RX, params.helm);
    expect(g.distanceM).toBeGreaterThan(20_000);
    expect(g.distanceM).toBeLessThan(25_000);
    expect(g.fwdAzDeg).toBeCloseTo(90, 0); // почти строго на восток
    expect(g.zone).toBe(zoneForLon(TX.L));
    // дирекционный угол = истинный азимут − сближение меридианов
    expect(Math.abs(g.gridAzDeg - g.fwdAzDeg)).toBeLessThan(3);
  });
});

describe("evaluateLink — плоский рельеф (все тайлы 100 м)", () => {
  const flatTiles = tileMap([
    makeFlatTile(47, 39, 100),
    makeFlatTile(47, 40, 100),
  ]);

  it("полностью соответствует формуле бюджета: PRx = EIRP − FSPL − diff + G_rx − L_f", () => {
    const link = evaluateLink(flatTiles, pathGeometry(TX, RX, params.helm), params);
    const expectedFspl = fsplDb(link.distanceM, params.fMHz);
    expect(link.fspl).toBeCloseTo(expectedFspl, 8);
    // Плоско: линия визирования над рельефом → LOS, diff = 0
    expect(link.diff.method).toBe("los");
    expect(link.diff.loss).toBe(0);
    const eirp = params.pTxDbm - params.txFeederDb + params.txGainDbi;
    const prx =
      eirp -
      expectedFspl -
      params.extraLossDb +
      params.rxGainDbi -
      params.rxFeederDb;
    expect(link.prxDbm).toBeCloseTo(prx, 8);
    expect(link.marginDb).toBeCloseTo(prx - params.sensitivityDbm, 8);
    expect(link.ok).toBe(true);
  });

  it("высота антенн над морем = рельеф + подвес", () => {
    const link = evaluateLink(flatTiles, pathGeometry(TX, RX, params.helm), params);
    expect(link.txTerrainM).toBeCloseTo(100, 0);
    expect(link.h1AbsM).toBeCloseTo(110, 0);
    expect(link.h2AbsM).toBeCloseTo(110, 0);
  });

  it("профиль содержит обе конечные точки и корректную сетку расстояний", () => {
    const link = evaluateLink(flatTiles, pathGeometry(TX, RX, params.helm), params);
    expect(link.pts.length).toBeGreaterThanOrEqual(30);
    expect(link.pts[0].d).toBe(0);
    expect(link.pts[link.pts.length - 1].d).toBeCloseTo(link.distanceM, -1);
    for (let i = 1; i < link.pts.length; i++) {
      expect(link.pts[i].d).toBeGreaterThan(link.pts[i - 1].d);
    }
  });

  it("совпадение точек ПРД/ПРМ → ошибка; >1000 км → ошибка", () => {
    expect(() => evaluateLink(flatTiles, pathGeometry(TX, TX, params.helm), params)).toThrow();
    const far = { B: 47.3, L: 39.3 + 20 }; // ~1300+ км не получится… используем прямую подмену geom
    const g = pathGeometry(TX, far, params.helm);
    expect(() =>
      evaluateLink(flatTiles, { ...g, distanceM: 1_500_000 }, params)
    ).toThrow(/1000/);
  });

  it("отсутствующие тайлы без синтетики → ошибка профиля", () => {
    expect(() =>
      evaluateLink(tileMap([]), pathGeometry(TX, RX, params.helm), params)
    ).toThrow();
  });
});

describe("evaluateLink — горный экран посередине трассы", () => {
  // Тайл N47E039 с «хребтом» по долготе 39.45: строки 3×3 слишком грубы,
  // поэтому делаем матрицу 5×5 (шаг 0.25°) с поднятым средним столбцом.
  it("пик выше линии визирования даёт неотрицательные потери и фиксирует препятствие", () => {
    const size = 5;
    const data = new Int16Array(size * size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        data[r * size + c] = c === 2 ? 400 : 100; // хребет 400 м
      }
    }
    const ridge = {
      name: "N47E039",
      latTop: 48,
      lonLeft: 39,
      size,
      step: 1 / (size - 1),
      arcSec: 900,
      data,
      bytes: size * size * 2,
    };
    const tiles = tileMap([ridge, makeFlatTile(47, 40, 100)]);
    const link = evaluateLink(tiles, pathGeometry(TX, RX, params.helm), params);
    expect(link.diff.loss).toBeGreaterThan(0);
    expect(["deygout", "bullington"]).toContain(link.diff.method);
    expect(link.obstacles.length).toBeGreaterThan(0);
    expect(link.obstacles[0].v).toBeGreaterThan(0);
    // Просвет отрицательный (экран выше LOS)
    expect(link.minClearance).toBeLessThan(0);
    // Бюджет: PRx меньше чистого FSPL-варианта ровно на потери дифракции
    const clean = fsplDb(link.distanceM, params.fMHz);
    const eirp = params.pTxDbm - params.txFeederDb + params.txGainDbi;
    expect(link.prxDbm).toBeCloseTo(
      eirp - clean - link.diff.loss + params.rxGainDbi - params.rxFeederDb,
      6
    );
  });
});
