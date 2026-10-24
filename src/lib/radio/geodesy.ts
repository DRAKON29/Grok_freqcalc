// Геодезические расчёты на эллипсоиде WGS-84 (формулы Винсенти).
// Используется для выборки рельефа HGT (файлы HGT — в WGS-84).

export const WGS84_A = 6378137.0;
export const WGS84_F = 1 / 298.257223563;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface InverseResult {
  distance: number; // м
  fwdAz: number; // рад, истинный азимут из p1 на p2
  revAz: number; // рад, истинный азимут из p2 на p1
}

export interface DirectResult {
  lat: number;
  lon: number;
  revAz: number; // рад, азимут из конечной точки на начальную
}

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

export function normalizeAzRad(a: number): number {
  const t = a % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}

export function normalizeAzDeg(a: number): number {
  const t = a % 360;
  return t < 0 ? t + 360 : t;
}

/** Обратная задача Винсенти: расстояние и азимуты между точками. */
export function vincentyInverse(p1: LatLon, p2: LatLon): InverseResult {
  const a = WGS84_A;
  const f = WGS84_F;
  const b = a * (1 - f);

  const L = (p2.lon - p1.lon) * D2R;
  const U1 = Math.atan((1 - f) * Math.tan(p1.lat * D2R));
  const U2 = Math.atan((1 - f) * Math.tan(p2.lat * D2R));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let sinLambda = 0;
  let cosLambda = 0;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let cos2SigmaM = 0;
  let cosSqAlpha = 1;
  let sinAlpha = 0;

  for (let i = 0; i < 200; i++) {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2 +
        (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2
    );
    if (sinSigma === 0) {
      return { distance: 0, fwdAz: 0, revAz: 0 }; // точки совпадают
    }
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM =
      cosSqAlpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha : 0;
    const C = (f / 16) * cosSqAlpha * (4 - f + 4 * f * cosSqAlpha);
    const prev = lambda;
    lambda =
      L +
      (1 - C) *
        f *
        sinAlpha *
        (sigma +
          C *
            sinSigma *
            (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lambda - prev) < 1e-12) break;
    if (i === 199) {
      throw new Error(
        "Точки почти диаметрально противоположны — задача не сходится"
      );
    }
  }

  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
  const A =
    1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
          (B / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma ** 2) *
            (-3 + 4 * cos2SigmaM ** 2)));

  const distance = b * A * (sigma - deltaSigma);
  const fwdAz = normalizeAzRad(
    Math.atan2(
      cosU2 * sinLambda,
      cosU1 * sinU2 - sinU1 * cosU2 * cosLambda
    )
  );
  const revAz = normalizeAzRad(
    Math.atan2(
      cosU1 * sinLambda,
      -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda
    ) + Math.PI
  );
  return { distance, fwdAz, revAz };
}

/** Прямая задача Винсенти: точка на заданном азимуте и расстоянии. */
export function vincentyDirect(
  p1: LatLon,
  fwdAzRad: number,
  s: number
): DirectResult {
  const a = WGS84_A;
  const f = WGS84_F;
  const b = a * (1 - f);

  const phi1 = p1.lat * D2R;
  const L1 = p1.lon * D2R;
  const tanU1 = (1 - f) * Math.tan(phi1);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;

  const sinAz = Math.sin(fwdAzRad);
  const cosAz = Math.cos(fwdAzRad);
  const sigma1 = Math.atan2(sinU1, cosU1 * cosAz);
  const sinAlpha = cosU1 * sinAz;
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
  const A =
    1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

  let sigma = s / (b * A);
  let sinSigma = Math.sin(sigma);
  let cosSigma = Math.cos(sigma);
  let cos2SigmaM = Math.cos(2 * sigma1 + sigma);

  for (let i = 0; i < 200; i++) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    const deltaSigma =
      B *
      sinSigma *
      (cos2SigmaM +
        (B / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
            (B / 6) *
              cos2SigmaM *
              (-3 + 4 * sinSigma ** 2) *
              (-3 + 4 * cos2SigmaM ** 2)));
    const prev = sigma;
    sigma = s / (b * A) + deltaSigma;
    if (Math.abs(sigma - prev) < 1e-12) break;
  }

  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAz;
  const phi2 = Math.atan2(
    sinU1 * cosSigma + cosU1 * sinSigma * cosAz,
    (1 - f) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp)
  );
  const lambda = Math.atan2(
    sinSigma * sinAz,
    cosU1 * cosSigma - sinU1 * sinSigma * cosAz
  );
  const C = (f / 16) * cosSqAlpha * (4 - f * (4 - 3 * cosSqAlpha));
  const L =
    lambda -
    (1 - C) *
      f *
      sinAlpha *
      (sigma +
        C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));

  const revAz = normalizeAzRad(
    Math.atan2(sinAlpha, -sinU1 * sinSigma + cosU1 * cosSigma * cosAz) +
      Math.PI
  );

  return { lat: phi2 * R2D, lon: (L1 + L) * R2D, revAz };
}
