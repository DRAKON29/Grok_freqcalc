// Тесты утилит формата, классификации сигнала и парсера траекторий.

import { describe, expect, it } from "vitest";
import {
  clamp,
  fmt,
  fmtDb,
  fmtDeg,
  fmtDms,
  fmtKm,
  fmtM,
  parseNum,
  parseIntStrict,
} from "@/lib/radio/format";
import { signalColor, signalQuality } from "@/lib/radio/signal";
import { parseTrajectoryFile } from "@/lib/radio/route";

const NBSP = "\u00A0";

describe("числовые форматтеры (русская нотация, детерминированные)", () => {
  it("fmt: неразрывные пробелы-разделители, запятая как десятичная, «−» для минуса", () => {
    expect(fmt(1234567)).toBe(`1${NBSP}234${NBSP}567`);
    expect(fmt(-12.346, 2)).toBe(`−12,35`);
    expect(fmt(Number.NaN)).toBe("—");
    expect(fmt(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("fmtM/fmtKm/fmtDb/fmtDeg дописывают единицы", () => {
    expect(fmtM(1500)).toBe(`1${NBSP}500${NBSP}м`);
    expect(fmtKm(12.3456)).toBe(`12,35${NBSP}км`);
    expect(fmtDb(-3.14, 1)).toBe(`−3,1${NBSP}дБ`);
    expect(fmtDeg(90)).toBe("90,0°");
  });

  it("fmtDms печатает ГрМс с русскими полушариями", () => {
    expect(fmtDms(55.7558, "lat")).toBe(`55°45′20,9″${NBSP}с.ш.`);
    expect(fmtDms(-33.5, "lat")).toContain("ю.ш.");
    expect(fmtDms(-78.25, "lon")).toContain("з.д.");
    expect(fmtDms(37.6175, "lon")).toContain("в.д.");
    expect(fmtDms(Number.NaN, "lat")).toBe("—");
  });
});

describe("парсеры ввода", () => {
  it("parseNum терпим к запятой и пробелам, NaN на мусор", () => {
    expect(parseNum("12,5")).toBeCloseTo(12.5, 10);
    expect(parseNum(" 3.14 ")).toBeCloseTo(3.14, 10);
    expect(Number.isNaN(parseNum("abc"))).toBe(true);
  });

  it("parseIntStrict отказывается на дробях и тексте", () => {
    expect(parseIntStrict("42")).toBe(42);
    expect(Number.isNaN(parseIntStrict("4.2"))).toBe(true);
    expect(Number.isNaN(parseIntStrict("x1"))).toBe(true);
  });

  it("clamp держит границы", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("классификация качества сигнала", () => {
  it("green ≥ запас, yellow [0, запас), red < 0 и не-конечные значения", () => {
    expect(signalQuality(10, 10)).toBe("green");
    expect(signalQuality(10.001, 10)).toBe("green");
    expect(signalQuality(5, 10)).toBe("yellow");
    expect(signalQuality(0, 10)).toBe("yellow");
    expect(signalQuality(-0.001, 10)).toBe("red");
    // Контракт движка: +Infinity (полный просвет) классифицируется как green,
    // но сама функция guard'ит не-конечные значения в red — фиксируем поведение.
    expect(signalQuality(Number.POSITIVE_INFINITY, 10)).toBe("red");
    expect(signalQuality(NaN, 10)).toBe("red");
    expect(signalQuality(Number.NEGATIVE_INFINITY, 10)).toBe("red");
  });

  it("signalColor соответствует качеству", () => {
    expect(signalColor(20, 10)).toBe("#16a34a");
    expect(signalColor(5, 10)).toBe("#ca8a04");
    expect(signalColor(-5, 10)).toBe("#dc2626");
  });
});

describe("parseTrajectoryFile (JSON route.points)", () => {
  const good = JSON.stringify({
    tripodHeight: 1.5,
    route: {
      points: [
        { lat: 55.75, lon: 37.6, altitude: 120 },
        { lat: "55,76", lng: 37.61, elevation: 130, speed: 1.4 },
      ],
    },
  });

  it("разбирает валидный файл, принимает alt/lng как синонимы", () => {
    const res = parseTrajectoryFile("track.json", good);
    expect(res.error).toBeNull();
    expect(res.trajectory?.points.length).toBe(2);
    expect(res.trajectory?.points[1].lon).toBeCloseTo(37.61, 6);
    expect(res.trajectory?.points[1].altitudeM).toBe(130);
    expect(res.trajectory?.tripodHeightM).toBe(1.5);
  });

  it("пропускает точки без высоты: все скипнуты → trajectory null с ошибкой", () => {
    const txt = JSON.stringify({
      route: { points: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
    });
    const res = parseTrajectoryFile("t.json", txt);
    expect(res.trajectory).toBeNull();
    expect(res.error).toContain("altitude");
  });

  it("не-JSON → понятная ошибка, а не исключение", () => {
    const res = parseTrajectoryFile("bad.txt", "привет мир");
    expect(res.trajectory).toBeNull();
    expect(res.error).toContain("не является корректным JSON");
  });

  it("пустой route.points → ошибка", () => {
    const res = parseTrajectoryFile("e.json", JSON.stringify({ route: { points: [] } }));
    expect(res.error).toContain("пуст");
  });

  it("чинит JSON без внешней фигурной скобки", () => {
    const res = parseTrajectoryFile(
      "w.json",
      '"route": {"points": [{"lat":5,"lon":5,"alt":0}]}'
    );
    expect(res.error).toBeNull();
    expect(res.trajectory?.points.length).toBe(1);
  });
});
