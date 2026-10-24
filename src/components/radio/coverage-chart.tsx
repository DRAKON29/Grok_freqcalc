// Круговая диаграмма зоны связи: центр — передатчик, север сверху.
// Чистый SVG (без библиотек графиков): 72 луча по 5°, кольца расстояний,
// метки румбов, отметки наилучшего/наихудшего азимута и позиция ПРМ.

import type { CoverageResult } from "@/lib/radio/engine";
import { fmt } from "@/lib/radio/format";
import type { PathGeom } from "@/lib/radio/engine";

const SIZE = 460;
const C = SIZE / 2;
const R_PX = 196;

const RUMB: Record<number, string> = { 0: "С", 90: "В", 180: "Ю", 270: "З" };

interface CoverageChartProps {
  coverage: CoverageResult;
  geom: PathGeom | null;
  beamWidthDeg?: number;
  className?: string;
}

export function CoverageChart({ coverage, geom, beamWidthDeg, className }: CoverageChartProps) {
  const rMax = coverage.analysisKm;
  const pxPerKm = R_PX / rMax;

  const xy = (azDeg: number, km: number): [number, number] => {
    // Азимут: 0° — север, по часовой стрелке; в SVG y растёт вниз.
    const a = (azDeg * Math.PI) / 180;
    const r = Math.max(0, Math.min(km, rMax)) * pxPerKm;
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  };

  // Заполненный полигон зоны (лучи через 5°).
  const pts = coverage.rays.map((ray) => xy(ray.azDeg, ray.km));
  const poly = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  const rings = [0.25, 0.5, 0.75, 1].map((f) => f * rMax);

  const best = xy(coverage.bestAz, coverage.bestKm);
  const worst = xy(coverage.worstAz, coverage.worstKm);

  let rxMarker: [number, number] | null = null;
  let rxClipped = false;
  if (geom) {
    const km = geom.distanceM / 1000;
    if (km <= rMax) {
      rxMarker = xy(geom.fwdAzDeg, km);
    } else {
      rxClipped = true;
      rxMarker = xy(geom.fwdAzDeg, rMax);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Зона связи, радиус анализа ${fmt(rMax, 1)} км`}
      className={className}
    >
      {/* кольца расстояний */}
      {rings.map((km, i) => (
        <g key={i}>
          <circle
            cx={C}
            cy={C}
            r={km * pxPerKm}
            fill="none"
            stroke="currentColor"
            strokeOpacity={i === rings.length - 1 ? 0.35 : 0.15}
            strokeDasharray={i === rings.length - 1 ? undefined : "3 5"}
          />
          <text
            x={C + 4}
            y={C - km * pxPerKm - 3}
            fontSize="10"
            fill="currentColor"
            fillOpacity="0.55"
          >
            {fmt(km, km < 10 ? 1 : 0)} км
          </text>
        </g>
      ))}

      {/* лучи-метки каждые 30° и румбы */}
      {Array.from({ length: 12 }, (_, i) => i * 30).map((az) => {
        const [x, y] = xy(az, rMax);
        const [x0, y0] = xy(az, 0);
        const labelR = rMax;
        const [lx, ly] = xy(az, labelR + 0.1);
        return (
          <g key={az}>
            <line
              x1={x0}
              y1={y0}
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={lx}
              y={ly}
              fontSize="11"
              fontWeight={RUMB[az] ? 700 : 400}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="currentColor"
              fillOpacity={RUMB[az] ? 0.9 : 0.45}
            >
              {RUMB[az] ?? String(az)}
            </text>
          </g>
        );
      })}

      {/* зона связи */}
      <polygon points={poly} fill="currentColor" fillOpacity="0.18" />
      <polygon
        points={poly}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.7"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* наилучший и наихудший азимуты */}
      <line
        x1={C}
        y1={C}
        x2={best[0]}
        y2={best[1]}
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeDasharray="4 4"
      />
      <circle cx={best[0]} cy={best[1]} r="3.5" fill="currentColor" fillOpacity="0.85" />
      <line
        x1={C}
        y1={C}
        x2={worst[0]}
        y2={worst[1]}
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeDasharray="2 4"
      />

      {/* приёмник */}
      {rxMarker ? (
        <g>
          <line
            x1={C}
            y1={C}
            x2={rxMarker[0]}
            y2={rxMarker[1]}
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="1.2"
          />
          <circle
            cx={rxMarker[0]}
            cy={rxMarker[1]}
            r="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={rxClipped ? "2 2" : undefined}
            strokeOpacity="0.9"
          />
        </g>
      ) : null}

      {/* ширина луча — две линии от центра */}
      {beamWidthDeg && beamWidthDeg > 0 && beamWidthDeg < 360 ? (() => {
        const centerAz = geom?.fwdAzDeg ?? 0;
        const half = beamWidthDeg / 2;
        const [x1, y1] = xy(centerAz - half, rMax);
        const [x2, y2] = xy(centerAz + half, rMax);
        return (
          <g>
            <line x1={C} y1={C} x2={x1} y2={y1} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="4 3" />
            <line x1={C} y1={C} x2={x2} y2={y2} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="4 3" />
            <text
              x={(C + x1) / 2 + 4}
              y={(C + y1) / 2}
              fontSize="9"
              fill="currentColor"
              fillOpacity="0.45"
            >
              {fmt(beamWidthDeg, 0)}°
            </text>
          </g>
        );
      })() : null}

      {/* передатчик в центре */}
      <circle cx={C} cy={C} r="4.5" fill="currentColor" />
      <circle cx={C} cy={C} r="8" fill="none" stroke="currentColor" strokeOpacity="0.4" />
    </svg>
  );
}
