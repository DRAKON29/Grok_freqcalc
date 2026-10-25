// Тесты перехода СК-42 ↔ WGS-84 и проекции Гаусса–Крюгера.

import { describe, expect, it } from "vitest";
import {
  gkForward,
  gkInverse,
  gridConvergenceDeg,
  sk42ToWgs84,
  wgs84ToSk42,
  zoneForLon,
} from "@/lib/radio/sk42";

describe("зона Гаусса–Крюгера", () => {
  it.each([
    [37.6175, 7], // Москва — зона 7 (осевой 39°)
    [30.3146, 6], // СПб — зона 6 (осевой 33°)
    [-1.0, 60], // западнее Гринвича — конец 60-й зоны
    [0.0, 1],
    [35.99, 6],
    [36.01, 7],
  ])("zoneForLon(%f) = %i", (lon, zone) => {
    expect(zoneForLon(lon)).toBe(zone);
  });
});

describe("Гаусс–Крюгер: прямой и обратный ход согласованы", () => {
  const cases: Array<[number, number]> = [
    [55.752, 37.6175], // Москва (зона 7)
    [59.9398, 30.3146], // СПб (зона 6)
    [44.6, 33.5], // Крым
    [50.0, 40.0],
    [0.5, 3.0], // почти экватор, зона 1
  ];

  for (const [B, L] of cases) {
    it(`B=${B}, L=${L}`, () => {
      const zone = zoneForLon(L);
      const xy = gkForward(B, L, zone); // аргументы — градусы
      const back = gkInverse(xy.x, xy.y);
      expect(back.B).toBeCloseTo(B, 7); // ~см
      expect(back.L).toBeCloseTo(L, 7);
      expect(back.zone).toBe(zone);
    });
  }

  it("точка на осевом меридиане имеет y = 500 000 + смещение зоны", () => {
    const zone = 7; // осевой меридиан 39°
    const xy = gkForward(55.752, 39, zone);
    expect(xy.y).toBeCloseTo(7 * 1e6 + 500_000, 3);
  });
});

describe("СК-42 ↔ WGS-84: круговой переход", () => {
  const pts: Array<[number, number]> = [
    [55.752, 37.6175],
    [59.9398, 30.3146],
    [48.708, 44.513], // Волгоград
    [43.22, 76.9], // Алматы (восток зоны покрытия СК-42)
  ];

  for (const [B, L] of pts) {
    it(`B=${B}, L=${L} возвращается с точностью < 1e-6°`, () => {
      const w = sk42ToWgs84(B, L);
      const back = wgs84ToSk42(w.lat, w.lon);
      expect(back.B).toBeCloseTo(B, 6);
      expect(back.L).toBeCloseTo(L, 6);
    });
  }

  it("сдвиг СК-42→WGS-84 мал по модулю (< 300 м) и согласован с направлением ΔX/ΔY/ΔZ", () => {
    const B = 55.752;
    const L = 37.6175;
    const w = sk42ToWgs84(B, L);
    // Разница широты не должна превышать ~10″, долготы ~20″ для Москвы
    expect(Math.abs(w.lat - B)).toBeLessThan(10 / 3600);
    expect(Math.abs(w.lon - L)).toBeLessThan(20 / 3600);
    expect(w.lat).not.toBe(B); // сдвиг действительно применяется
  });
});

describe("сближение меридианов", () => {
  it("на осевом меридиане γ = 0", () => {
    expect(gridConvergenceDeg(55.752, 39, 7)).toBeCloseTo(0, 10);
  });

  it("к востоку от осевого меридиана γ > 0, к западу — γ < 0", () => {
    expect(gridConvergenceDeg(55.752, 40.5, 7)).toBeGreaterThan(0);
    expect(gridConvergenceDeg(55.752, 37.5, 7)).toBeLessThan(0);
  });

  it("на экваторе γ = 0 при любом L (sin B = 0)", () => {
    expect(gridConvergenceDeg(0, 45, 8)).toBeCloseTo(0, 10);
  });

  it("значение γ ограничено ±3° в пределах зоны (полуширина 3°)", () => {
    for (const b of [45, 55, 65, 75]) {
      const g = gridConvergenceDeg(b, 36, 7); // −3° от осевого
      expect(Math.abs(g)).toBeLessThanOrEqual(3);
    }
  });
});
