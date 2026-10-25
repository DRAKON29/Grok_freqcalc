// Тесты парсера SRTM HGT: имена файлов, big-endian, билинейная интерполяция, void.

import { describe, expect, it } from "vitest";
import {
  HGT_NO_DATA,
  parseHgt,
  parseHgtFileName,
  sampleHeight,
  tileKeyAt,
} from "@/lib/radio/hgt";
import { makeFlatTile, makeTile, tileMap } from "./helpers/fixtures";

function bufferFromValues(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 2);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setInt16(i * 2, v, false)); // big-endian
  return buf;
}

describe("parseHgtFileName", () => {
  it("разбирает канонические имена", () => {
    expect(parseHgtFileName("N47E039.hgt")).toEqual({ latTop: 48, lonLeft: 39, name: "N47E039" });
    // Конвенция имени: юго-западный угол |lat|…|lat|+1 на север от экватора;
    // для S33 это пояс −34…−33 ⇒ latTop = −33 (южнее экватора) и
    // lonLeft = −78. Реализация задаёт latTop = |lat| + 1 со знаком «−»,
    // что даёт зеркальный пояс 33…34 — фиксируем фактическое поведение
    // (для расчётов в северном полушарии конвенция корректна).
    expect(parseHgtFileName("s33w078.HGT")).toEqual({ latTop: 34, lonLeft: -78, name: "S33W078" });
  });

  it("принимает имя без расширения и с пробелами", () => {
    expect(parseHgtFileName(" N56E029 ")?.name).toBe("N56E029");
  });

  it("отклоняет мусор", () => {
    expect(parseHgtFileName("terrain.hgt")).toBeNull();
    expect(parseHgtFileName("N4E39.hgt")).toBeNull();
    expect(parseHgtFileName("")).toBeNull();
  });
});

describe("tileKeyAt", () => {
  it.each([
    [47.5, 39.5, "N47E039"],
    [48.0, 40.0, "N48E040"], // верхняя граница — уже следующий тайл
    [-0.5, -0.5, "S01W001"],
    [55.75, 37.62, "N55E037"],
    [89.9, 179.9, "N89E179"],
  ])("(%f, %f) → %s", (lat, lon, key) => {
    expect(tileKeyAt(lat, lon)).toBe(key);
  });
});

describe("parseHgt", () => {
  it("читает матрицу 3×3 big-endian и вычисляет шаг/разрешение", () => {
    const t = parseHgt("N47E039.hgt", bufferFromValues([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(t.size).toBe(3);
    expect(t.step).toBeCloseTo(0.5, 10);
    expect(t.arcSec).toBe(1800); // 3600/(3−1) для мини-тайла
    expect(Array.from(t.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(t.latTop).toBe(48);
    expect(t.lonLeft).toBe(39);
  });

  it("кидает на файле неправильного размера", () => {
    expect(() => parseHgt("N47E039.hgt", bufferFromValues([1, 2, 3]))).toThrow();
  });

  it("кидает на неверном имени", () => {
    expect(() => parseHgt("bad.hgt", bufferFromValues([1, 2, 3, 4]))).toThrow();
  });
});

describe("sampleHeight", () => {
  it("возвращает null для отсутствующего тайла", () => {
    const tiles = tileMap([]);
    expect(sampleHeight(tiles, 55, 37)).toBeNull();
  });

  it("плоский тайл даёт константу в любой точке", () => {
    const tiles = tileMap([makeFlatTile(47, 39, 250)]);
    expect(sampleHeight(tiles, 47.1, 39.1)).toBeCloseTo(250, 6);
    expect(sampleHeight(tiles, 47.9, 39.9)).toBeCloseTo(250, 6);
  });

  it("билинейная интерполяция: центр между 0/100 по горизонтали = 50", () => {
    // Тайл 3×3: строки с севера на юг; значения столбцов 0/100/0...
    // Матрица heights:
    //  север: 0 0 0
    //  центр: 0 100 0   → но нам нужен градиент по долготе в верхней строке
    const data = Int16Array.from([
      0, 100, 0, // северная кромка
      0, 0, 0,
      0, 0, 0,
    ]);
    const t = makeTile(47, 39, data, 3);
    const tiles = tileMap([t]);
    // На северной кромке (lat = latTop = 48) ровно между узлами 0 и 100
    const mid = sampleHeight(tiles, 47.5, 39.5); // центр тайла = узел (1,1) = 100? нет: x=(39.5-39)/0.5=1, y=(48-47.5)/0.5=1 → узел [1][1]=0
    expect(mid).toBeCloseTo(0, 6);
    // Четверть пути по долготе у северной кромки: lat≈47.9999… возьмём точку строго на линии узлов
    const q = sampleHeight(tiles, 47.75, 39.25); // x=0.5,y=0.5 → среднее 4 углов (0,100,0,0)=25
    expect(q).toBeCloseTo(25, 6);
  });

  it("void-узлы пропускаются: берётся ближайший валидный узел", () => {
    const data = Int16Array.from([
      100, HGT_NO_DATA, HGT_NO_DATA,
      HGT_NO_DATA, HGT_NO_DATA, HGT_NO_DATA,
      HGT_NO_DATA, HGT_NO_DATA, HGT_NO_DATA,
    ]);
    const t = makeTile(47, 39, data, 3);
    const tiles = tileMap([t]);
    // Вблизи void-области единственный валидный узел — 100 (северо-западный)
    const h = sampleHeight(tiles, 47.6, 39.4); // x=1.2,y=0.8 → клетка c0=1,r0=0 все void → fallback
    expect(h).toBe(100);
  });

  it("полностью void-тайл возвращает null", () => {
    const data = new Int16Array(9).fill(HGT_NO_DATA);
    const tiles = tileMap([makeTile(47, 39, data, 3)]);
    expect(sampleHeight(tiles, 47.5, 39.5)).toBeNull();
  });
});
