// Синтетический рельеф (из прототипа Grok_freqcalc) — fallback, когда
// HGT-тайлы не загружены. Гауссовы «холмы» вокруг типичной области (Москва).
// Не для ответственных расчётов; только демо и отладка UI.

export interface Hill {
  lat: number;
  lon: number;
  heightM: number;
  sigmaDeg: number;
}

const DEFAULT_HILLS: Hill[] = [
  { lat: 55.75, lon: 37.6, heightM: 180, sigmaDeg: 0.08 },
  { lat: 55.8, lon: 37.7, heightM: 120, sigmaDeg: 0.06 },
  { lat: 55.7, lon: 37.55, heightM: 90, sigmaDeg: 0.1 },
  { lat: 55.78, lon: 37.45, heightM: 150, sigmaDeg: 0.07 },
  { lat: 55.72, lon: 37.68, heightM: 100, sigmaDeg: 0.05 },
  { lat: 55.82, lon: 37.55, heightM: 70, sigmaDeg: 0.09 },
  { lat: 55.68, lon: 37.62, heightM: 110, sigmaDeg: 0.07 },
];

/** Высота синтетического рельефа, м. */
export function syntheticElevation(
  lat: number,
  lon: number,
  hills: Hill[] = DEFAULT_HILLS,
  baseM = 50
): number {
  let z = baseM;
  for (const h of hills) {
    const d2 =
      ((lat - h.lat) / h.sigmaDeg) ** 2 + ((lon - h.lon) / h.sigmaDeg) ** 2;
    z += h.heightM * Math.exp(-0.5 * d2);
  }
  return z;
}
