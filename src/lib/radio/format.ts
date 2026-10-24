// Форматирование чисел в русской нотации (детерминированное, без Intl,
// чтобы SSR и браузер совпадали байт в байт).

const NBSP = "\u00A0";

export function fmt(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(digits);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (neg ? "−" : "") + grouped + (frac ? `,${frac}` : "");
}

export function fmtM(meters: number, digits = 0): string {
  return `${fmt(meters, digits)}${NBSP}м`;
}

export function fmtKm(km: number, digits = 2): string {
  return `${fmt(km, digits)}${NBSP}км`;
}

export function fmtDeg(deg: number, digits = 1): string {
  return `${fmt(deg, digits)}°`;
}

export function fmtDb(db: number, digits = 1): string {
  return `${fmt(db, digits)}${NBSP}дБ`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad3(n: number): string {
  return n < 10 ? `00${n}` : n < 100 ? `0${n}` : String(n);
}

/** 55.7558 → «55°45′20,9″ с.ш.» */
export function fmtDms(deg: number, kind: "lat" | "lon"): string {
  if (!Number.isFinite(deg)) return "—";
  const hem =
    kind === "lat" ? (deg >= 0 ? "с.ш." : "ю.ш.") : deg >= 0 ? "в.д." : "з.д.";
  const abs = Math.abs(deg);
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let s = Math.round(((abs - d) * 60 - m) * 60 * 10) / 10;
  if (s >= 59.95) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d += 1;
  }
  return `${d}°${pad2(m)}′${fmt(s, 1)}″${NBSP}${hem}`;
}

export { pad2, pad3 };

/** Строгий разбор числа: допускает запятую и пробелы, не допускает мусор. */
export function parseNum(s: string): number {
  const t = s.trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

/** Строгий разбор целого. */
export function parseIntStrict(s: string): number {
  const t = s.trim().replace(/\s+/g, "");
  if (!/^[+-]?\d+$/.test(t)) return NaN;
  return Number(t);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
