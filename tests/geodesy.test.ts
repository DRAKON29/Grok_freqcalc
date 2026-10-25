// Эталонные тесты геодезии (Винсенти, WGS-84).
// Ожидаемые значения — из независимых калькуляторов (NOAA / GeographicLib):
// точность формул Винсенти на эллипсоиде ~ мм…см.

import { describe, expect, it } from "vitest";
import {
  normalizeAzDeg,
  normalizeAzRad,
  vincentyDirect,
  vincentyInverse,
} from "@/lib/radio/geodesy";

describe("vincentyInverse — эталонные расстояния", () => {
  it("Москва (Кремль) → Санкт-Петербург (Адмиралтейство)", () => {
    // 55.7520/37.6175 → 59.9398/30.3146, независимый эталон ≈ 636.19 км
    const r = vincentyInverse({ lat: 55.752, lon: 37.6175 }, { lat: 59.9398, lon: 30.3146 });
    expect(r.distance).toBeCloseTo(636_185, -1); // ±5 м
    expect(r.fwdAz).toBeGreaterThan(Math.PI / 2); // северо-западное направление
    expect(normalizeAzDeg(r.fwdAz * (180 / Math.PI))).toBeCloseTo(320.1, 0);
  });

  it("экваториальный градус долготы ≈ 111.319 км (радиус WGS-84)", () => {
    const r = vincentyInverse({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(r.distance).toBeCloseTo(111_319.5, -1); // ±5 м
    expect(normalizeAzDeg(r.fwdAz * (180 / Math.PI))).toBeCloseTo(90, 6);
  });

  it("меридианный градус широты на экваторе ≈ 110.574 км", () => {
    const r = vincentyInverse({ lat: 0, lon: 10 }, { lat: 1, lon: 10 });
    expect(r.distance).toBeCloseTo(110_574.4, -1);
    expect(r.fwdAz * (180 / Math.PI)).toBeCloseTo(0, 6);
  });

  it("совпадающие точки дают нулевое расстояние", () => {
    const r = vincentyInverse({ lat: 55, lon: 37 }, { lat: 55, lon: 37 });
    expect(r.distance).toBeCloseTo(0, 6);
  });

  it("обратная задача симметрична: прямой ход ↔ обратный азимут", () => {
    const a = { lat: 48.8566, lon: 2.3522 }; // Париж
    const b = { lat: 50.0755, lon: 14.4378 }; // Прага
    const fwd = vincentyInverse(a, b);
    const rev = vincentyInverse(b, a);
    expect(rev.distance).toBeCloseTo(fwd.distance, 3);
    expect(normalizeAzDeg(rev.revAz * (180 / Math.PI))).toBeCloseTo(
      fwd.fwdAz * (180 / Math.PI),
      6
    );
  });
});

describe("vincentyDirect — прямая задача согласована с обратной", () => {
  it("круг: из точки по азимуту на расстояние → возвращаемся в ту же точку", () => {
    const p1 = { lat: 55.752, lon: 37.6175 };
    const p2 = { lat: 59.9398, lon: 30.3146 };
    const inv = vincentyInverse(p1, p2);
    const dir = vincentyDirect(p1, inv.fwdAz, inv.distance);
    expect(dir.lat).toBeCloseTo(p2.lat, 7);
    expect(dir.lon).toBeCloseTo(p2.lon, 7);
  });

  it("азимут 0° ведёт строго на север", () => {
    const dir = vincentyDirect({ lat: 0, lon: 20 }, 0, 1_000_000);
    expect(dir.lon).toBeCloseTo(20, 8);
    expect(dir.lat).toBeGreaterThan(8.9);
    expect(dir.lat).toBeLessThan(9.1);
  });
});

describe("нормализация азимутов", () => {
  it.each([
    [-90, 270],
    [360, 0],
    [720, 0],
    [-360, 0],
    [45, 45],
  ])("normalizeAzDeg(%f) = %f", (input, output) => {
    expect(normalizeAzDeg(input)).toBeCloseTo(output, 10);
  });

  it("normalizeAzRad держит результат в [0, 2π)", () => {
    for (const v of [-7, -0.1, 0, 6.5, 13]) {
      const n = normalizeAzRad(v);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(2 * Math.PI);
    }
  });
});
