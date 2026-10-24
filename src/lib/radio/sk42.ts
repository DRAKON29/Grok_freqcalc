// СК-42 (Пулково-1942): эллипсоид Красовского, проекция Гаусса–Крюгера (k0 = 1,
// осевой меридиан зоны L0 = 6·n − 3). Переход к WGS-84 — трёхпараметрический
// сдвиг геоцентрических координат (Хелмерт); по умолчанию значения
// ГОСТ Р 51794-2008: ΔX = 23,57 м; ΔY = −140,95 м; ΔZ = −79,8 м.

export const KRASOVSKY_A = 6378245.0;
export const KRASOVSKY_F = 1 / 298.3;

const E2 = 2 * KRASOVSKY_F - KRASOVSKY_F * KRASOVSKY_F; // первый эксцентриситет²
const EP2 = E2 / (1 - E2); // второй эксцентриситет²

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface Helmert3 {
  dx: number;
  dy: number;
  dz: number;
}

export const DEFAULT_HELMERT_SK42_WGS84: Helmert3 = {
  dx: 23.57,
  dy: -140.95,
  dz: -79.8,
};

export interface Sk42Point {
  B: number; // широта, градусы
  L: number; // долгота, градусы
}

function meridianArc(phi: number): number {
  const a = KRASOVSKY_A;
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return (
    a *
      (1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) *
      phi -
    a *
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) *
      Math.sin(2 * phi) +
    a * ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
    a * ((35 * e6) / 3072) * Math.sin(6 * phi)
  );
}

/** Номер шестиградусной зоны по долготе (1…60). */
export function zoneForLon(L: number): number {
  const Ln = ((L % 360) + 360) % 360;
  return Math.min(60, Math.floor(Ln / 6) + 1);
}

export interface GkResult {
  x: number; // от экватора, м
  y: number; // с номером зоны, м
}

/** Прямая задача: B, L (СК-42) → координаты Гаусса–Крюгера. */
export function gkForward(B: number, L: number, zone: number): GkResult {
  const L0 = (6 * zone - 3) * D2R;
  const phi = B * D2R;
  let l = L * D2R - L0;
  l = Math.atan2(Math.sin(l), Math.cos(l)); // нормализация в [−π, π]

  const sinB = Math.sin(phi);
  const cosB = Math.cos(phi);
  const tanB = Math.tan(phi);
  const N = KRASOVSKY_A / Math.sqrt(1 - E2 * sinB * sinB);
  const T = tanB * tanB;
  const C = EP2 * cosB * cosB;
  const A = l * cosB;
  const M = meridianArc(phi);

  const x =
    M +
    N *
      tanB *
      ((A * A) / 2 +
        ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
        ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Math.pow(A, 6)) / 720);
  const y =
    N *
      (A +
        ((1 - T + C) * Math.pow(A, 3)) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Math.pow(A, 5)) / 120) +
    500000 +
    zone * 1e6;

  return { x, y };
}

export interface GkInverseResult {
  B: number;
  L: number;
  zone: number;
}

/** Обратная задача: x (от экватора), y (с номером зоны) → B, L (СК-42). */
export function gkInverse(x: number, y: number): GkInverseResult {
  const zone = Math.floor(y / 1e6);
  if (zone < 1 || zone > 60) {
    throw new Error("Номер зоны в координате Y вне диапазона 1…60");
  }
  const yRel = y - (zone * 1e6 + 500000);
  const L0 = (6 * zone - 3) * D2R;

  const M = x; // k0 = 1
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const m0 = 1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256;
  const mu = M / (KRASOVSKY_A * m0);

  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const e1_2 = e1 * e1;
  const e1_3 = e1_2 * e1;
  const e1_4 = e1_3 * e1;

  const phi1 =
    mu +
    (3 * e1) / 2 * Math.sin(2 * mu) -
    (27 * e1_3) / 32 * Math.sin(2 * mu) +
    (21 * e1_2) / 16 * Math.sin(4 * mu) -
    (55 * e1_4) / 32 * Math.sin(4 * mu) +
    (151 * e1_3) / 96 * Math.sin(6 * mu) +
    (1097 * e1_4) / 512 * Math.sin(8 * mu);

  const sinP1 = Math.sin(phi1);
  const cosP1 = Math.cos(phi1);
  const tanP1 = Math.tan(phi1);
  const C1 = EP2 * cosP1 * cosP1;
  const T1 = tanP1 * tanP1;
  const N1 = KRASOVSKY_A / Math.sqrt(1 - E2 * sinP1 * sinP1);
  const R1 = (KRASOVSKY_A * (1 - E2)) / Math.pow(1 - E2 * sinP1 * sinP1, 1.5);
  const D = yRel / N1;
  const k = (N1 * tanP1) / R1;

  const B =
    phi1 -
    k *
      (D * D / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * Math.pow(D, 4)) / 24 +
        ((61 +
          90 * T1 +
          298 * C1 +
          45 * T1 * T1 -
          252 * EP2 -
          3 * C1 * C1) *
          Math.pow(D, 6)) /
          720);

  const L =
    L0 +
    (D -
      ((1 + 2 * T1 + C1) * Math.pow(D, 3)) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) *
        Math.pow(D, 5)) /
        120) /
      cosP1;

  return { B: B * R2D, L: L * R2D, zone };
}

function blToEcefKrasovsky(B: number, L: number): [number, number, number] {
  const phi = B * D2R;
  const lam = L * D2R;
  const sinB = Math.sin(phi);
  const cosB = Math.cos(phi);
  const N = KRASOVSKY_A / Math.sqrt(1 - E2 * sinB * sinB);
  return [
    N * cosB * Math.cos(lam),
    N * cosB * Math.sin(lam),
    N * (1 - E2) * sinB,
  ];
}

function ecefToBlWgs84(
  X: number,
  Y: number,
  Z: number
): { lat: number; lon: number } {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2w = 2 * f - f * f;
  const b = a * (1 - f);
  const ep2w = e2w / (1 - e2w);
  const p = Math.sqrt(X * X + Y * Y);
  const L = Math.atan2(Y, X);
  const th = Math.atan2(Z * a, p * b);
  const B = Math.atan2(
    Z + ep2w * b * Math.pow(Math.sin(th), 3),
    p - e2w * a * Math.pow(Math.cos(th), 3)
  );
  return { lat: B * R2D, lon: L * R2D };
}

/** Переход СК-42 → WGS-84 (высота принимается 0 — для выборки HGT её достаточно). */
export function sk42ToWgs84(
  B: number,
  L: number,
  helm: Helmert3 = DEFAULT_HELMERT_SK42_WGS84
): { lat: number; lon: number } {
  const [X, Y, Z] = blToEcefKrasovsky(B, L);
  return ecefToBlWgs84(X + helm.dx, Y + helm.dy, Z + helm.dz);
}

/** Сближение меридианов (γ, градусы): восточнее осевого меридиана — положительное. */
export function gridConvergenceDeg(B: number, L: number, zone: number): number {
  const L0 = 6 * zone - 3;
  const l = (L - L0) * D2R;
  return Math.atan(Math.tan(l) * Math.sin(B * D2R)) * R2D;
}

// --- Обратный переход WGS-84 → СК-42 (для точек с карты и траекторий) ---

const WGS_A = 6378137.0;
const WGS_F = 1 / 298.257223563;
const WGS_E2 = 2 * WGS_F - WGS_F * WGS_F;

function blToEcefWgs84(lat: number, lon: number): [number, number, number] {
  const phi = lat * D2R;
  const lam = lon * D2R;
  const sinB = Math.sin(phi);
  const cosB = Math.cos(phi);
  const N = WGS_A / Math.sqrt(1 - WGS_E2 * sinB * sinB);
  return [
    N * cosB * Math.cos(lam),
    N * cosB * Math.sin(lam),
    N * (1 - WGS_E2) * sinB,
  ];
}

/** Метод Боуринга: ECEF (эллипсоид Красовского) → B, L. */
function ecefToBlKrasovsky(
  X: number,
  Y: number,
  Z: number
): { B: number; L: number } {
  const p = Math.sqrt(X * X + Y * Y);
  const L = Math.atan2(Y, X);
  const b = KRASOVSKY_A * (1 - KRASOVSKY_F);
  const ep2 = E2 / (1 - E2);
  const th = Math.atan2(Z * KRASOVSKY_A, p * b);
  const B = Math.atan2(
    Z + ep2 * b * Math.pow(Math.sin(th), 3),
    p - E2 * KRASOVSKY_A * Math.pow(Math.cos(th), 3)
  );
  return { B: B * R2D, L: L * R2D };
}

/**
 * Переход WGS-84 → СК-42 (обратный трёхпараметричесому сдвигу Хелмерта).
 * Высота игнорируется — используется только для горизонтальных координат.
 */
export function wgs84ToSk42(
  lat: number,
  lon: number,
  helm: Helmert3 = DEFAULT_HELMERT_SK42_WGS84
): Sk42Point {
  const [X, Y, Z] = blToEcefWgs84(lat, lon);
  return ecefToBlKrasovsky(X - helm.dx, Y - helm.dy, Z - helm.dz);
}
