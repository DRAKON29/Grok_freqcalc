// Тесты чистой логики hover-подсказки профиля (Фаза 2.4):
// знак просвета согласован с minClearance движка (>0 — LOS над рельефом).

import { describe, expect, it } from "vitest";
import type { ProfilePoint } from "@/lib/radio/engine";
import { deriveProfile, type RawProfile } from "@/lib/radio/engine";
import { evaluateHoverPoint, pointClearance } from "@/lib/radio/profile";

const F = 433;

function mkPts(
  distM: number,
  terrainAt: (d: number) => number
): RawProfile {
  const pts = [];
  const step = distM / 10;
  for (let i = 0; i <= 10; i++) {
    const d = i * step;
    const h = terrainAt(d);
    // кривизна не важна для знаков — hc = h
    pts.push({ d, h, hc: h, valid: true });
  }
  return { distanceM: distM, pts, txTerrainM: 0, rxTerrainM: 0, gapCount: 0, usedTiles: [], missingTiles: [] };
}

describe("pointClearance", () => {
  const p = (los: number, hc: number, r1: number): ProfilePoint => ({
    d: 5000,
    h: hc,
    hc,
    valid: true,
    los,
    r1,
    v: r1 > 0 ? ((hc - los) * Math.SQRT2) / r1 : -Infinity,
  });

  it("положительный, когда LOS выше рельефа (конвенция minClearance)", () => {
    expect(pointClearance(p(100, 80, 10))).toBeCloseTo(2, 10);
  });
  it("отрицательный, когда рельеф выше LOS (экранирование)", () => {
    expect(pointClearance(p(100, 120, 10))).toBeCloseTo(-2, 10);
  });
  it("Infinity у антенн (r1 = 0)", () => {
    expect(pointClearance(p(100, 80, 0))).toBe(Infinity);
  });
});

describe("evaluateHoverPoint", () => {
  it("null на пустом массиве", () => {
    expect(evaluateHoverPoint([], 100)).toBeNull();
  });

  it("выбирает ближайшую точку по дистанции", () => {
    const raw = mkPts(10_000, () => 50);
    const pts = deriveProfile(raw, 100, 100, F);
    const hp = evaluateHoverPoint(pts, 3_400);
    expect(hp).not.toBeNull();
    expect(hp!.dM).toBe(3_000); // шаг 1 км → ближайшая 3 км, а не 4 км
  });

  it("плоский профиль под LOS → clear, просвет > 0.6", () => {
    const raw = mkPts(10_000, () => 50);
    const pts = deriveProfile(raw, 100, 100, F);
    const hp = evaluateHoverPoint(pts, 5_000)!;
    expect(hp.status).toBe("clear");
    expect(hp.clearance).toBeGreaterThan(0.6);
    expect(hp.v).toBeLessThan(0); // препятствие ниже LOS
  });

  it("хребет выше LOS → blocked, просвет < 0", () => {
    const raw = mkPts(10_000, (d) => (Math.abs(d - 5_000) < 600 ? 300 : 50));
    const pts = deriveProfile(raw, 100, 100, F);
    const hp = evaluateHoverPoint(pts, 5_000)!;
    expect(hp.status).toBe("blocked");
    expect(hp.clearance).toBeLessThan(0);
    expect(hp.v).toBeGreaterThan(0);
  });

  it("зазор меньше радиуса зоны Френеля → grazing", () => {
    // На середине 10-км трассы при 433 МГц r1 ≈ 37 м; возьмём зазор ~10 м.
    const raw = mkPts(10_000, () => 50);
    const pts0 = deriveProfile(raw, 100, 100, F);
    const r1mid = pts0[5].r1;
    expect(r1mid).toBeGreaterThan(20);
    const gap = r1mid * 0.3; // просвет 0.3 r1 ∈ (0; 0.6) → grazing
    const raw2 = mkPts(10_000, (d) => (Math.abs(d - 5_000) < 600 ? 100 - gap : 50));
    const pts = deriveProfile(raw2, 100, 100, F);
    const hp = evaluateHoverPoint(pts, 5_000)!;
    expect(hp.clearance).toBeCloseTo(0.3, 5);
    expect(hp.status).toBe("grazing");
  });

  it("невалидная точка (нет данных HGT) → edge", () => {
    const raw = mkPts(10_000, () => 50);
    raw.pts[5].valid = false;
    const pts = deriveProfile(raw, 100, 100, F);
    const hp = evaluateHoverPoint(pts, 5_000)!;
    expect(hp.status).toBe("edge");
    expect(Number.isNaN(hp.fresnelFraction)).toBe(true);
  });

  it("концы трассы (r1 = 0) → edge, clearance = Infinity", () => {
    const raw = mkPts(10_000, () => 50);
    const pts = deriveProfile(raw, 100, 100, F);
    const hp = evaluateHoverPoint(pts, 0)!;
    expect(hp.status).toBe("edge");
    expect(hp.clearance).toBe(Infinity);
  });

  it("fresnelFraction совпадает с clearance (доля радиуса зоны)", () => {
    const raw = mkPts(10_000, () => 50);
    const pts = deriveProfile(raw, 100, 100, F);
    const hp = evaluateHoverPoint(pts, 5_000)!;
    expect(hp.fresnelFraction).toBe(hp.clearance);
  });

  it("terrainM/losM соответствуют выбранной точке", () => {
    const raw = mkPts(10_000, (d) => 50 + d / 100);
    const pts = deriveProfile(raw, 100, 100, F);
    const hp = evaluateHoverPoint(pts, 7_000)!;
    const src = pts.find((p) => p.d === 7_000)!;
    expect(hp.terrainM).toBe(src.h);
    expect(hp.losM).toBe(src.los);
  });
});
