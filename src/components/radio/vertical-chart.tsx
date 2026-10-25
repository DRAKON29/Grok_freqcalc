// Вертикальный срез: уровень на входе второй станции vs высота антенны.
// Цвет линии/точек: зелёный / жёлтый / красный по запасу.

import type { VerticalResult } from "@/lib/radio/engine";
import { fmt } from "@/lib/radio/format";
import {
  SIGNAL_COLORS,
  SIGNAL_LABELS,
  signalQuality,
} from "@/lib/radio/signal";

const W = 520;
const H = 280;
const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 36;

interface VerticalChartProps {
  result: VerticalResult;
  fadeMarginDb: number;
  className?: string;
}

export function VerticalChart({
  result,
  fadeMarginDb,
  className,
}: VerticalChartProps) {
  const pts = result.points;
  if (!pts.length) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={className}>
        <text x={W / 2} y={H / 2} textAnchor="middle" fill="currentColor" fillOpacity="0.5">
          Нет данных
        </text>
      </svg>
    );
  }

  const hMin = pts[0].heightM;
  const hMax = pts[pts.length - 1].heightM;
  const prxVals = pts.map((p) => p.prxDbm);
  let yMin = Math.min(...prxVals, result.thresholdDbm);
  let yMax = Math.max(...prxVals, result.thresholdDbm);
  const pad = Math.max(2, (yMax - yMin) * 0.08);
  yMin -= pad;
  yMax += pad;

  const x = (h: number) =>
    PAD_L + ((h - hMin) / (hMax - hMin || 1)) * (W - PAD_L - PAD_R);
  const y = (prx: number) =>
    PAD_T + (1 - (prx - yMin) / (yMax - yMin || 1)) * (H - PAD_T - PAD_B);

  // Сегменты линии по качеству
  const segments: Array<{ q: string; d: string }> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const q = signalQuality(a.marginDb, fadeMarginDb);
    const d = `M ${x(a.heightM).toFixed(1)} ${y(a.prxDbm).toFixed(1)} L ${x(b.heightM).toFixed(1)} ${y(b.prxDbm).toFixed(1)}`;
    const last = segments[segments.length - 1];
    if (last && last.q === q) last.d += ` L ${x(b.heightM).toFixed(1)} ${y(b.prxDbm).toFixed(1)}`;
    else segments.push({ q, d });
  }

  const thrY = y(result.thresholdDbm);
  const sensY = y(result.thresholdDbm - fadeMarginDb);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Вертикальный анализ двусторонней связи"
      className={className}
    >
      {/* зоны фона */}
      <rect
        x={PAD_L}
        y={PAD_T}
        width={W - PAD_L - PAD_R}
        height={Math.max(0, thrY - PAD_T)}
        fill={SIGNAL_COLORS.green}
        fillOpacity={0.08}
      />
      <rect
        x={PAD_L}
        y={thrY}
        width={W - PAD_L - PAD_R}
        height={Math.max(0, sensY - thrY)}
        fill={SIGNAL_COLORS.yellow}
        fillOpacity={0.1}
      />
      <rect
        x={PAD_L}
        y={Math.min(sensY, H - PAD_B)}
        width={W - PAD_L - PAD_R}
        height={Math.max(0, H - PAD_B - Math.min(sensY, H - PAD_B))}
        fill={SIGNAL_COLORS.red}
        fillOpacity={0.08}
      />

      {/* сетка */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const yy = PAD_T + f * (H - PAD_T - PAD_B);
        const val = yMax - f * (yMax - yMin);
        return (
          <g key={f}>
            <line
              x1={PAD_L}
              y1={yy}
              x2={W - PAD_R}
              y2={yy}
              stroke="currentColor"
              strokeOpacity="0.12"
            />
            <text
              x={PAD_L - 6}
              y={yy + 3}
              fontSize="10"
              textAnchor="end"
              fill="currentColor"
              fillOpacity="0.5"
            >
              {fmt(val, 1)}
            </text>
          </g>
        );
      })}

      {/* порог запаса и чувствительности */}
      <line
        x1={PAD_L}
        y1={thrY}
        x2={W - PAD_R}
        y2={thrY}
        stroke={SIGNAL_COLORS.green}
        strokeWidth="1.2"
        strokeDasharray="5 4"
        strokeOpacity="0.8"
      />
      <line
        x1={PAD_L}
        y1={sensY}
        x2={W - PAD_R}
        y2={sensY}
        stroke={SIGNAL_COLORS.red}
        strokeWidth="1"
        strokeDasharray="3 3"
        strokeOpacity="0.6"
      />

      {/* кривая по сегментам */}
      {segments.map((s, i) => (
        <path
          key={i}
          d={s.d}
          fill="none"
          stroke={SIGNAL_COLORS[s.q as keyof typeof SIGNAL_COLORS]}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}

      {/* точки */}
      {pts
        .filter((_, i) => i % 4 === 0 || i === pts.length - 1)
        .map((p, i) => (
          <circle
            key={i}
            cx={x(p.heightM)}
            cy={y(p.prxDbm)}
            r="2.5"
            fill={SIGNAL_COLORS[signalQuality(p.marginDb, fadeMarginDb)]}
          />
        ))}

      {/* ось X */}
      <text
        x={(PAD_L + W - PAD_R) / 2}
        y={H - 6}
        fontSize="10"
        textAnchor="middle"
        fill="currentColor"
        fillOpacity="0.5"
      >
        Высота антенны 2-й станции над рельефом, м
      </text>
      <text
        x={12}
        y={H / 2}
        fontSize="10"
        fill="currentColor"
        fillOpacity="0.5"
        transform={`rotate(-90 12 ${H / 2})`}
        textAnchor="middle"
      >
        Уровень на входе, дБм
      </text>

      {/* легенда */}
      <g transform={`translate(${PAD_L + 4}, ${PAD_T + 4})`}>
        {(
          [
            ["green", SIGNAL_LABELS.green],
            ["yellow", SIGNAL_LABELS.yellow],
            ["red", SIGNAL_LABELS.red],
          ] as const
        ).map(([k, label], i) => (
          <g key={k} transform={`translate(${i * 130}, 0)`}>
            <rect width="8" height="8" rx="1" fill={SIGNAL_COLORS[k]} />
            <text x="11" y="8" fontSize="9" fill="currentColor" fillOpacity="0.7">
              {label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
