// Чистые (без React) вычисления для hover-подсказки профиля трассы (Фаза 2.4).
// Знак просвета согласован с движком: clearance = (los − hc)/r1 — как
// minClearance в buildLinkResult (>0 — LOS над рельефом, <0 — экран).

import type { ProfilePoint } from "@/lib/radio/engine";

export interface HoverPointInfo {
  dM: number; // дистанция от станции A, м
  terrainM: number; // фактическая высота рельефа, м (без кривизны)
  losM: number; // высота линии визирования на этой дистанции, м
  /** Нормированный просвет: (los − hc)/r1. >0 — LOS над рельефом,
   *  <0 — препятствие экранирует LOS. Infinity, если r1 ≈ 0 (у антенн). */
  clearance: number;
  /** Параметр препятствия v = (hc − los)·√2/r1 (знак этапа 1):
   *  v > 0 — препятствие выше LOS (дифракция), v ≤ 0 — LOS свободна. */
  v: number;
  /** Заполнение первой зоны Френеля со знаком: fresnelFraction = clearance
   *  (доля радиуса зоны, на которую LOS выше/ниже рельефа). */
  fresnelFraction: number;
  status: "clear" | "grazing" | "blocked" | "edge";
}

/**
 * Просвет в долях r1 по точке профиля. Конвенция знака — как у minClearance
 * движка: (los − hc)/r1 (положительный = линия визирования над рельефом).
 */
export function pointClearance(p: ProfilePoint): number {
  if (!(p.r1 > 0)) return Infinity;
  return (p.los - p.hc) / p.r1;
}

/**
 * Оценка точки профиля под курсором: ближайшая точка трассы с нормированным
 * просветом и статусом зоны Френеля.
 *  - blocked: v > 0 (препятство выше LOS);
 *  - grazing: 0 ≥ v > −1 (LOS свободна, но первая зона Френеля затронута);
 *  - clear:   v ≤ −1 (просвет больше радиуса зоны);
 *  - edge:    концы трассы (r1 = 0) или отсутствующие данные HGT.
 */
export function evaluateHoverPoint(
  pts: ProfilePoint[],
  distanceM: number
): HoverPointInfo | null {
  if (pts.length === 0) return null;
  let best = pts[0];
  let bestDist = Math.abs(pts[0].d - distanceM);
  for (let i = 1; i < pts.length; i++) {
    const dd = Math.abs(pts[i].d - distanceM);
    if (dd < bestDist) {
      bestDist = dd;
      best = pts[i];
    }
  }
  const clearance = pointClearance(best);
  const isEdge = !best.valid || !(best.r1 > 0);
  // Статус по нормированному просвету c = (los − hc)/r1 — та же метрика,
  // что и minClearance движка (>0.6 — зона Френеля чиста, как в комментарии
  // к LinkResult; c ≤ 0 — LOS экранирована).
  let status: HoverPointInfo["status"];
  if (isEdge) status = "edge";
  else if (clearance <= 0) status = "blocked";
  else if (clearance < 0.6) status = "grazing";
  else status = "clear";
  return {
    dM: best.d,
    terrainM: best.h,
    losM: best.los,
    clearance,
    v: best.v,
    fresnelFraction: isEdge ? NaN : clearance,
    status,
  };
}
