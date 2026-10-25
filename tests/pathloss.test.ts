// Эталонные тесты модели распространения: FSPL (ITU-R P.525),
// дифракция на ножевом крае (ITU-R P.526 J(v)), кривизна Земли.

import { describe, expect, it } from "vitest";
import {
  EARTH_R,
  curvatureDropM,
  diffractionLoss,
  fresnelRadiusM,
  fsplDb,
  knifeEdgeJ,
  wavelengthM,
} from "@/lib/radio/pathloss";
import { profile } from "./helpers/fixtures";

describe("fsplDb — базовые потери в свободном пространстве", () => {
  it("эталон: 1 ГГц, 1 км → 92.44 дБ", () => {
    expect(fsplDb(1000, 1000)).toBeCloseTo(92.44, 6);
  });

  it("эталон: 100 МГц, 10 км → те же 92.44 дБ (произведение f·d одинаково)", () => {
    expect(fsplDb(10_000, 100)).toBeCloseTo(92.44, 6);
  });

  it("эталон: 150 МГц, 30 км → 105.50 дБ", () => {
    expect(fsplDb(30_000, 150)).toBeCloseTo(105.5, 1);
  });

  it("удвоение дистанции добавляет 6.02 дБ", () => {
    const a = fsplDb(50_000, 433);
    const b = fsplDb(100_000, 433);
    expect(b - a).toBeCloseTo(20 * Math.log10(2), 8);
  });

  it("удвоение частоты добавляет 6.02 дБ", () => {
    expect(fsplDb(30_000, 800) - fsplDb(30_000, 400)).toBeCloseTo(
      20 * Math.log10(2),
      8
    );
  });
});

describe("wavelengthM / fresnelRadiusM", () => {
  it("λ(433 МГц) = 0.6924 м", () => {
    expect(wavelengthM(433)).toBeCloseTo(0.69236, 4);
  });

  it("первая зона Френеля: 400 МГц, плечо 5+5 км → 43.3 м", () => {
    const lambda = wavelengthM(400);
    const expected = Math.sqrt((lambda * 5000 * 5000) / 10000);
    expect(fresnelRadiusM(5000, 5000, 400)).toBeCloseTo(expected, 6);
    expect(expected).toBeCloseTo(43.29, 1);
  });
});

describe("knifeEdgeJ — кривая ITU-R P.526", () => {
  it("полный просвет (v ≤ −0.78) → 0 дБ", () => {
    expect(knifeEdgeJ(-1)).toBe(0);
    // Граница Piecewise: при v = −0.78 ветка J(v≤−0.78)=0, непрерывна слева
    expect(knifeEdgeJ(-0.79)).toBe(0);
    expect(knifeEdgeJ(-0.77)).toBeGreaterThan(0);
  });

  it("скользящий луч (v = 0) → ≈ 6.0 дБ по кривой Lee", () => {
    expect(knifeEdgeJ(0)).toBeCloseTo(6.03, 1);
  });

  it("v = 1 → ≈ 13.9 дБ; v = 2 → ≈ 19.0 дБ; монотонность по диапазону", () => {
    expect(knifeEdgeJ(1)).toBeCloseTo(13.93, 1);
    expect(knifeEdgeJ(2)).toBeCloseTo(19.04, 1);
    let prev = -Infinity;
    for (let v = -2; v <= 10; v += 0.25) {
      const j = knifeEdgeJ(v);
      expect(j).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = j;
    }
  });
});

describe("curvatureDropM — понижение поверхности (сферичность)", () => {
  it("середина трассы 100 км, k=1 → d1·d2/2R = 196.2 м", () => {
    expect(curvatureDropM(50_000, 50_000, 1)).toBeCloseTo(
      (50_000 * 50_000) / (2 * EARTH_R),
      6
    );
  });

  it("k=4/3 уменьшает прогиб в 1.33 раза", () => {
    const k1 = curvatureDropM(30_000, 70_000, 1);
    const k43 = curvatureDropM(30_000, 70_000, 4 / 3);
    expect(k1 / k43).toBeCloseTo(4 / 3, 6);
  });
});

describe("diffractionLoss — выбор метода и физический смысл", () => {
  const f = 433;

  it("чистый просвет → method=los, 0 дБ", () => {
    const pts = profile([
      [0, 0],
      [50_000, 50],
      [100_000, 0],
    ]);
    const r = diffractionLoss(pts, 300, 300, f);
    expect(r.method).toBe("los");
    expect(r.loss).toBe(0);
    expect(r.maxV).toBeLessThanOrEqual(0);
  });

  it("край чуть выше линии визирования (v≈0+) → потери ≥ 6 дБ", () => {
    // Контракт движка: метод LOS выбирается при maxV ≤ 0 (строгий порог),
    // поэтому берём экран на 0.5 м над линией визирования — v чуть больше нуля.
    const pts = profile([
      [0, 0],
      [25_000, 50],
      [50_000, 100.5],
      [75_000, 50],
      [100_000, 0],
    ]);
    const r = diffractionLoss(pts, 100, 100, f);
    expect(r.method).not.toBe("los");
    expect(r.loss).toBeGreaterThanOrEqual(6.0);
    expect(r.maxVd).toBe(50_000);
  });

  it("высокий экран даёт большие потери, чем низкий (монотонность по высоте края)", () => {
    const low = diffractionLoss(profile([[0, 0], [50_000, 120], [100_000, 0]]), 100, 100, f);
    const high = diffractionLoss(profile([[0, 0], [50_000, 250], [100_000, 0]]), 100, 100, f);
    expect(high.loss).toBeGreaterThan(low.loss);
  });

  it("частотная зависимость: выше частота — больше потери при том же профиле", () => {
    const pts = profile([[0, 0], [50_000, 200], [100_000, 0]]);
    const lo = diffractionLoss(pts, 100, 100, 150);
    const hi = diffractionLoss(pts, 100, 100, 900);
    expect(hi.loss).toBeGreaterThan(lo.loss);
  });

  it("два ножа: Дейгаут суммирует вклады с весами (потери > одиночного края)", () => {
    const single = diffractionLoss(profile([[0, 0], [50_000, 200], [100_000, 0]]), 100, 100, f);
    const double = diffractionLoss(
      profile([[0, 0], [33_000, 200], [66_000, 200], [100_000, 0]]),
      100,
      100,
      f
    );
    expect(double.loss).toBeGreaterThan(single.loss);
  });

  it("короткие трассы (<3 точек) не падают, а считаются LOS", () => {
    expect(diffractionLoss(profile([[0, 0], [10, 0]]), 5, 5, f).method).toBe("los");
    expect(diffractionLoss([], 5, 5, f).method).toBe("los");
  });
});
