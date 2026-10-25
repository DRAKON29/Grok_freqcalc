// Общие тестовые утилиты: конструкторы HGT-тайлов и эталонные профили.

import { HgtTile, HgtTileMap } from "@/lib/radio/hgt";

/**
 * Мини-тайл 3×3 (шаг 1°) с постоянной высотой. Покрывает [lat0, lat0+1] ×
 * [lon0, lon0+1]; имя — юго-западный угол по конвенции SRTM.
 */
export function makeFlatTile(
  latFloor: number,
  lonFloor: number,
  heightM: number
): HgtTile {
  const name = tileName(latFloor, lonFloor);
  const data = new Int16Array(9).fill(heightM);
  return {
    name,
    latTop: latFloor + 1,
    lonLeft: lonFloor,
    size: 3,
    step: 0.5,
    arcSec: 7200,
    data,
    bytes: 18,
  };
}

/** Тайл из явной матрицы Int16Array (row-major, строка 0 — северная кромка). */
export function makeTile(
  latFloor: number,
  lonFloor: number,
  data: Int16Array,
  size: number
): HgtTile {
  return {
    name: tileName(latFloor, lonFloor),
    latTop: latFloor + 1,
    lonLeft: lonFloor,
    size,
    step: 1 / (size - 1),
    arcSec: Math.round(3600 / (size - 1)),
    data,
    bytes: size * size * 2,
  };
}

export function tileName(latFloor: number, lonFloor: number): string {
  const latS = `${latFloor >= 0 ? "N" : "S"}${String(Math.abs(latFloor)).padStart(2, "0")}`;
  const lonS = `${lonFloor >= 0 ? "E" : "W"}${String(Math.abs(lonFloor)).padStart(3, "0")}`;
  return `${latS}${lonS}`;
}

export function tileMap(tiles: HgtTile[]): HgtTileMap {
  return new Map(tiles.map((t) => [t.name, t]));
}

/** Однопутевый профиль рельефа для детерминированных тестов diffractionLoss. */
export function profile(
  pairs: Array<[number, number]>
): Array<{ d: number; hc: number }> {
  return pairs.map(([d, hc]) => ({ d, hc }));
}
