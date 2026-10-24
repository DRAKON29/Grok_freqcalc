// Вертикальный анализ: уровень сигнала на входе ПРМ (дБм) в зависимости
// от высоты антенны ПРМ над рельефом (м). Пороговая линия — чувствительность
// + запас на замирание. Точка пересечения — минимальная высота устойчивой связи.
// Чистый SVG, детерминированный рендер.

import { fmt } from "@/lib/radio/format";
import type { VerticalResult } from "@/lib/radio/engine";

const W = 880;
const H = 280;
const PAD_L = 56;
const PAD_R = 16;
const PAD_T = 14;
const PAD_B = 34;

interface VerticalChartProps {
  result: VerticalResult;
  className?: string;
}

export function VerticalChart({ result, className }: VerticalChartProps) {
  const pts = result.points;
  if (pts.length < 2) return null;

  const hMin = 0;
  const hMax = pts[pts.length - 1].heightM;

  let pMin = Infinity;
  let pMax = -Infinity;
  for (const p of pts) {
    pMin = Math.min(pMin, p.prxDbm);
    pMax = Math.max(pMax, p.prxDbm);
  }
  pMin = Math.min(pMin, result.thresholdDbm);
  pMax = Math.max(pMax, result.thresholdDbm);
  const span = Math.max(10, pMax - pMin);
  pMax += span * 0.1;
  pMin -= span * 0.1;

  const x = (h: number) =>
    PAD_L + ((h - hMin) / (hMax - hMin)) * (W - PAD_L - PAD_R);
  const y = (p: number) =>
    PAD_T + ((pMax - p) / (pMax - pMin)) * (H - PAD_T - PAD_B);

  const curve = pts
    .map((p) => `${x(p.heightM).toFixed(1)},${y(p.prxDbm).toFixed(1)}`)
    .join(" ");

  const thresholdY = y(result.thresholdDbm);

  // Зона ниже порога — заливка под кривой до линии порога.
  const belowArea = `${x(pts[0].heightM).toFixed(1)},${thresholdY.toFixed(1)} ${curve} ${x(pts[pts.length - 1].heightM).toFixed(1)},${thresholdY.toFixed(1)}`;

  const hStep = niceStep(hMax);
  const hTicks: number[] = [];
  for (let h = 0; h <= hMax + 1e-9; h += hStep) hTicks.push(h);

  const pStep = niceStep(pMax - pMin);
  const pTicks: number[] = [];
  for (let p = Math.ceil(pMin / pStep) * pStep; p < pMax; p += pStep)
    pTicks.push(p);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Уровень сигнала от высоты антенны ПРМ"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* сетка мощности */}
      {pTicks.map((p) => (
        <g key={`gp-${p}`}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(p)}
            y2={y(p)}
            stroke="currentColor"
            strokeOpacity="0.1"
          />
          <text
            x={PAD_L - 6}
            y={y(p)}
            fontSize="10"
            textAnchor="end"
            dominantBaseline="middle"
            fill="currentColor"
            fillOpacity="0.55"
          >
            {fmt(p, 0)}
          </text>
        </g>
      ))}

      {/* сетка высот */}
      {hTicks.map((h) => (
        <text
          key={`gh-${h}`}
          x={x(h)}
          y={H - PAD_B + 14}
          fontSize="10"
          textAnchor="middle"
          fill="currentColor"
          fillOpacity="0.55"
        >
          {fmt(h, 0)}
        </text>
      ))}

      {/* подписи осей */}
      <text
        x={PAD_L - 6}
        y={PAD_T - 2}
        fontSize="10"
        textAnchor="end"
        fill="currentColor"
        fillOpacity="0.45"
      >
        дБм
      </text>
      <text
        x={W - PAD_R}
        y={H - PAD_B + 28}
        fontSize="10"
        textAnchor="end"
        fill="currentColor"
        fillOpacity="0.45"
      >
        высота ПРМ над рельефом, м
      </text>

      {/* пороговая линия */}
      <line
        x1={PAD_L}
        x2={W - PAD_R}
        y1={thresholdY}
        y2={thresholdY}
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="1.2"
        strokeDasharray="6 4"
      />
      <text
        x={W - PAD_R - 4}
        y={thresholdY - 4}
        fontSize="10"
        textAnchor="end"
        fill="currentColor"
        fillOpacity="0.55"
      >
        порог {fmt(result.thresholdDbm, 0)} дБм
      </text>

      {/* заливка между кривой и порогом (область потери сигнала) */}
      <polygon points={belowArea} fill="currentColor" fillOpacity="0.06" />

      {/* кривая сигнала */}
      <polyline
        points={curve}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      {/* маркер минимальной высоты */}
      {result.minHeightM !== null && (
        <g>
          <line
            x1={x(result.minHeightM)}
            y1={thresholdY}
            x2={x(result.minHeightM)}
            y2={H - PAD_B}
            stroke="currentColor"
            strokeOpacity="0.4"
            strokeDasharray="3 3"
          />
          <circle
            cx={x(result.minHeightM)}
            cy={thresholdY}
            r="3.5"
            fill="currentColor"
          />
          <text
            x={x(result.minHeightM)}
            y={thresholdY - 8}
            fontSize="10"
            textAnchor="middle"
            fill="currentColor"
            fillOpacity="0.7"
          >
            {fmt(result.minHeightM, 1)} м
          </text>
        </g>
      )}
    </svg>
  );
}

function niceStep(range: number): number {
  const raw = range / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const norm = raw / pow;
  const mult = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return mult * pow;
}
