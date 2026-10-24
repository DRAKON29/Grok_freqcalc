// Модель распространения: базовые потери в свободном пространстве
// (ITU-R P.525) и дифракция на рельефе (ITU-R P.526, «нож лезвия»):
// главный край — метод Дейгаута с весами 1 / 0,5 / 0,25 по уровням
// рекурсии (учитываются только точки над линией визирования, v > 0),
// плюс построение Буллингтона; из двух оценок берётся большая.

export const EARTH_R = 6371000; // м, средний радиус Земли

/** Длина волны, м (f в МГц). */
export function wavelengthM(fMHz: number): number {
  return 299.792458 / fMHz;
}

/** Базовые потери в свободном пространстве, дБ. */
export function fsplDb(dMeters: number, fMHz: number): number {
  return 32.44 + 20 * Math.log10(fMHz) + 20 * Math.log10(dMeters / 1000);
}

/** Радиус первой зоны Френеля, м. */
export function fresnelRadiusM(d1: number, d2: number, fMHz: number): number {
  const lambda = wavelengthM(fMHz);
  return Math.sqrt((lambda * d1 * d2) / (d1 + d2));
}

/** Потери на одиночном «ноже лезвия», дБ (ITU-R P.526, J(v)). */
export function knifeEdgeJ(v: number): number {
  if (v <= -0.78) return 0;
  return (
    6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1)
  );
}

/** Понижение поверхности Земли (сферичность), м, для точки на d1 от начала. */
export function curvatureDropM(d1: number, d2: number, k: number): number {
  return (d1 * d2) / (2 * k * EARTH_R);
}

export interface DiffPoint {
  d: number; // расстояние от ПРД, м
  hc: number; // высота рельефа с учётом кривизны Земли, м
}

export interface DiffractionResult {
  loss: number; // дБ
  maxV: number;
  maxVd: number; // м
  method: "los" | "deygout" | "bullington";
}

/**
 * Дифракционные потери по профилю. h1/h2 — высоты антенн над уровнем моря
 * (рельеф уже исправлен на кривизну). Точки концов исключаются.
 */
export function diffractionLoss(
  points: DiffPoint[],
  h1: number,
  h2: number,
  fMHz: number
): DiffractionResult {
  const n = points.length;
  if (n < 3) return { loss: 0, maxV: -Infinity, maxVd: 0, method: "los" };
  const D = points[n - 1].d;
  if (D <= 0) return { loss: 0, maxV: -Infinity, maxVd: 0, method: "los" };
  const lambda = wavelengthM(fMHz);

  const losAt = (d: number, dA: number, hA: number, dB: number, hB: number) =>
    hA + ((hB - hA) * (d - dA)) / (dB - dA);

  // Параметр v для точки p на участке [dA, dB] с высотами концов hA, hB.
  const vOf = (p: DiffPoint, dA: number, hA: number, dB: number, hB: number) => {
    const d1 = p.d - dA;
    const d2 = dB - p.d;
    if (d1 <= 0 || d2 <= 0) return -Infinity;
    const los = losAt(p.d, dA, hA, dB, hB);
    return (p.hc - los) * Math.sqrt((2 * (dB - dA)) / (lambda * d1 * d2));
  };

  let maxV = -Infinity;
  let maxVd = 0;
  for (let i = 1; i < n - 1; i++) {
    const v = vOf(points[i], 0, h1, D, h2);
    if (v > maxV) {
      maxV = v;
      maxVd = points[i].d;
    }
  }
  if (maxV <= 0) {
    // Ни одна точка профиля не выходит над линией визирования — просвет чист
    return { loss: 0, maxV, maxVd, method: "los" };
  }

  // Дейгаут: главный край, затем рекурсивно по подпрофилям с весом вдвое меньше.
  // Подучасток даёт вклад, только если внутри есть точка НАД его линией (v > 0).
  const deygout = (
    dA: number,
    hA: number,
    dB: number,
    hB: number,
    weight: number,
    depth: number
  ): number => {
    let best = -Infinity;
    let bestP: DiffPoint | null = null;
    for (const p of points) {
      if (p.d <= dA || p.d >= dB) continue;
      const v = vOf(p, dA, hA, dB, hB);
      if (v > best) {
        best = v;
        bestP = p;
      }
    }
    if (!bestP || best <= 0) return 0;
    let loss = weight * knifeEdgeJ(best);
    if (depth < 3) {
      loss += deygout(dA, hA, bestP.d, bestP.hc, weight * 0.5, depth + 1);
      loss += deygout(bestP.d, bestP.hc, dB, hB, weight * 0.5, depth + 1);
    }
    return loss;
  };
  const deygoutLoss = deygout(0, h1, D, h2, 1, 0);

  // Буллингтон: пересечение огибающих лучей от концов профиля.
  let bullLoss = 0;
  let slopeTx = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const s = (points[i].hc - h1) / points[i].d;
    if (s > slopeTx) slopeTx = s;
  }
  let slopeRx = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const s = (h2 - points[i].hc) / (D - points[i].d);
    if (s > slopeRx) slopeRx = s;
  }
  if (Number.isFinite(slopeTx) && Number.isFinite(slopeRx)) {
    const denom = slopeTx - slopeRx;
    if (denom > 1e-15) {
      const dEdge = (h2 - slopeRx * D - h1) / denom;
      if (dEdge > 0 && dEdge < D) {
        const hEdge = h1 + slopeTx * dEdge;
        const v =
          (hEdge - losAt(dEdge, 0, h1, D, h2)) *
          Math.sqrt((2 * D) / (lambda * dEdge * (D - dEdge)));
        bullLoss = knifeEdgeJ(v);
      }
    }
  }

  if (bullLoss > deygoutLoss) {
    return { loss: bullLoss, maxV, maxVd, method: "bullington" };
  }
  return { loss: deygoutLoss, maxV, maxVd, method: "deygout" };
}
