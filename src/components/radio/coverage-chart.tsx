// Круговая диаграмма зоны связи.
// Зелёная зона — уверенный сигнал (запас ≥ fadeMargin).
// Жёлтая — неустойчивый (0 ≤ запас < fadeMargin).
// Красная (фон за пределами) — связи нет.

import type { CoverageResult, PathGeom } from "@/lib/radio/engine";
import { fmt } from "@/lib/radio/format";
import { SIGNAL_COLORS, SIGNAL_LABELS } from "@/lib/radio/signal";

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

export function CoverageChart({
  coverage,
  geom,
  beamWidthDeg,
  className,
}: CoverageChartProps) {
  const rMax = coverage.analysisKm;
  const pxPerKm = R_PX / rMax;

  const xy = (azDeg: number, km: number): [number, number] => {
    const a = (azDeg * Math.PI) / 180;
    const r = Math.max(0, Math.min(km, rMax)) * pxPerKm;
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  };

  const polyFrom = (getKm: (r: (typeof coverage.rays)[0]) => number) =>
    coverage.rays
      .map((ray) => {
        const [x, y] = xy(ray.azDeg, getKm(ray));
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const polyWeak = polyFrom((r) => r.kmWeak ?? r.km);
  const polyGood = polyFrom((r) => r.km);

  const rings = [0.25, 0.5, 0.75, 1].map((f) => f * rMax);
  const best = xy(coverage.bestAz, coverage.bestKm);
  const worst = xy(coverage.worstAz, coverage.worstKm);

  let rxMarker: [number, number] | null = null;
  let rxClipped = false;
  if (geom) {
    const km = geom.distanceM / 1000;
    if (km <= rMax) rxMarker = xy(geom.fwdAzDeg, km);
    else {
      rxClipped = true;
      rxMarker = xy(geom.fwdAzDeg, rMax);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Зона двусторонней связи, радиус анализа ${fmt(rMax, 1)} км`}
      className={className}
    >
      {/* фон — зона «связи нет» */}
      <circle cx={C} cy={C} r={R_PX} fill={SIGNAL_COLORS.red} fillOpacity={0.12} />

      {/* кольца */}
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

      {/* жёлтая зона — неустойчивый сигнал */}
      <polygon
        points={polyWeak}
        fill={SIGNAL_COLORS.yellow}
        fillOpacity={0.35}
        stroke={SIGNAL_COLORS.yellow}
        strokeOpacity={0.7}
        strokeWidth="1"
      />

      {/* зелёная зона — уверенный сигнал */}
      <polygon
        points={polyGood}
        fill={SIGNAL_COLORS.green}
        fillOpacity={0.45}
        stroke={SIGNAL_COLORS.green}
        strokeOpacity={0.9}
        strokeWidth="1.5"
      />

      {/* сектор ДН */}
      {beamWidthDeg != null && beamWidthDeg > 0 && beamWidthDeg < 360 && (
        <path
          d={beamPath(0, beamWidthDeg, R_PX)}
          fill="currentColor"
          fillOpacity="0.06"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="1"
        />
      )}

      {/* оси румбов */}
      {[0, 90, 180, 270].map((az) => {
        const [x, y] = xy(az, rMax);
        return (
          <g key={az}>
            <line
              x1={C}
              y1={C}
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeOpacity="0.2"
            />
            <text
              x={C + (x - C) * 1.08}
              y={C + (y - C) * 1.08}
              fontSize="12"
              fontWeight="600"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="currentColor"
              fillOpacity="0.7"
            >
              {RUMB[az]}
            </text>
          </g>
        );
      })}

      {/* best / worst */}
      <circle cx={best[0]} cy={best[1]} r="4" fill={SIGNAL_COLORS.green} />
      <circle cx={worst[0]} cy={worst[1]} r="4" fill={SIGNAL_COLORS.yellow} />

      {/* второй приёмопередатчик */}
      {rxMarker && (
        <g>
          <circle
            cx={rxMarker[0]}
            cy={rxMarker[1]}
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeOpacity="0.9"
          />
          <circle
            cx={rxMarker[0]}
            cy={rxMarker[1]}
            r="2.5"
            fill="currentColor"
            fillOpacity="0.9"
          />
          {rxClipped && (
            <text
              x={rxMarker[0] + 8}
              y={rxMarker[1] - 8}
              fontSize="10"
              fill="currentColor"
              fillOpacity="0.6"
            >
              за пределами
            </text>
          )}
        </g>
      )}

      {/* центр — станция A */}
      <circle cx={C} cy={C} r="5" fill="currentColor" fillOpacity="0.9" />
      <circle cx={C} cy={C} r="2" fill="var(--background, #fff)" />

      {/* легенда */}
      <g transform={`translate(12, ${SIZE - 52})`}>
        {(
          [
            ["green", SIGNAL_LABELS.green],
            ["yellow", SIGNAL_LABELS.yellow],
            ["red", SIGNAL_LABELS.red],
          ] as const
        ).map(([k, label], i) => (
          <g key={k} transform={`translate(0, ${i * 14})`}>
            <rect
              width="10"
              height="10"
              rx="2"
              fill={SIGNAL_COLORS[k]}
              fillOpacity={0.85}
            />
            <text x="14" y="9" fontSize="10" fill="currentColor" fillOpacity="0.75">
              {label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function beamPath(centerAz: number, widthDeg: number, r: number): string {
  const half = widthDeg / 2;
  const a0 = ((centerAz - half) * Math.PI) / 180;
  const a1 = ((centerAz + half) * Math.PI) / 180;
  const x0 = C + r * Math.sin(a0);
  const y0 = C - r * Math.cos(a0);
  const x1 = C + r * Math.sin(a1);
  const y1 = C - r * Math.cos(a1);
  const large = widthDeg > 180 ? 1 : 0;
  return `M ${C} ${C} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
}
