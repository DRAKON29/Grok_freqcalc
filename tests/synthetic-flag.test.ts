// Фаза 3.2: маркировка синтетического рельефа.
// Проверяем, что syntheticCount/syntheticUsed честно отражают, какие точки
// профиля взяты из демо-модели высот (реальный DEM отсутствовал).

import { describe, expect, it } from "vitest";
import { buildProfileRaw, pathGeometry, type RadioParams } from "@/lib/radio/engine";
import { DEFAULT_HELMERT_SK42_WGS84 } from "@/lib/radio/sk42";
import { makeFlatTile, tileMap } from "./helpers/fixtures";

const params: Pick<RadioParams, "kFactor"> = { kFactor: 4 / 3 };

const TX = { B: 47.3, L: 39.3 };
const RX = { B: 47.3, L: 39.6 };

function raw(useSynthetic: boolean, withTiles: boolean) {
  const geom = pathGeometry(TX, RX, DEFAULT_HELMERT_SK42_WGS84);
  const tiles = withTiles
    ? tileMap([makeFlatTile(47, 39, 100), makeFlatTile(47, 40, 100)])
    : tileMap([]);
  return buildProfileRaw(
    tiles,
    geom.txWgs,
    (geom.fwdAzDeg * Math.PI) / 180,
    geom.distanceM,
    100,
    params.kFactor,
    useSynthetic
  );
}

describe("buildProfileRaw.syntheticCount (Фаза 3.2)", () => {
  it("полный DEM → нулевой счётчик даже при включённом useSynthetic", () => {
    const r = raw(true, true);
    expect(r.syntheticCount).toBe(0);
    expect(r.gapCount).toBe(0);
  });

  it("пустой DEM + useSynthetic → все внутренние точки синтетические, gaps нет", () => {
    const r = raw(true, false);
    // nPts+1 точек всего; крайние тоже сэмплируются, но gapCount==0,
    // т.к. синтетика подставлена вместо отсутствующих высот
    expect(r.gapCount).toBe(0);
    expect(r.syntheticCount).toBeGreaterThan(0);
    // при useSynthetic отсутствующие тайлы не помечаются missing —
    // высоты подставлены из демо-модели, сигнал об этом несёт syntheticCount
    expect(r.missingTiles.length).toBe(0);
  });

  it("пустой DEM без useSynthetic → бросок «Нет данных HGT» (данные не подменяются)", () => {
    // Конвенция движка: без синтетики отсутствующие тайлы — это ошибка данных,
    // а не молчаливые gaps; syntheticUsed при этом недостижим ложно.
    expect(() => raw(false, false)).toThrow(/Нет данных HGT/);
  });
});
