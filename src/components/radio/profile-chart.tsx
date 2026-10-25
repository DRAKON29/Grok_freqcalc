// Вертикальный разрез трассы: рельеф, линия визирования, зона Френеля.
// Цвет линии связи — по качеству двустороннего канала.

import { fmt } from "@/lib/radio/format";
import type { LinkResult } from "@/lib/radio/engine";
import {
  SIGNAL_COLORS,
  SIGNAL_LABELS,
  signalQuality,
} from "@/lib/radio/signal";

const W = 880;
const H = 320;
const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 14;
const PAD_B = 30;

interface ProfileChartProps {
  link: LinkResult;
  fadeMarginDb?: number;
  className?: string;
}

export function ProfileChart({
  link,
  fadeMarginDb = 0,
  className,
}: ProfileChartProps) {
  const D = link.distanceM;
  const pts = link.pts;
  const q = signalQuality(link.marginDb, fadeMarginDb);
  const linkColor = SIGNAL_COLORS[q];

  let hMin = Infinity;
  let hMax = -Infinity;
  for (const p of pts) {
    hMin = Math.min(hMin, p.hc);
    hMax = Math.max(hMax, p.hc, p.los + 10);
    if (p.d > 0 && p.d < D) hMin = Math.min(hMin, p.los - p.r1);
  }
  hMin = Math.min(hMin, Math.min(link.h1AbsM, link.h2AbsM) - 20);
  hMax = Math.max(hMax, Math.max(link.h1AbsM, link.h2AbsM) + 20);
  const span = Math.max(50, hMax - hMin);
  hMax += span * 0.08;
  hMin -= span * 0.05;

  const x = (d: number) => PAD_L + (d / D) * (W - PAD_L - PAD_R);
  const y = (h: number) =>
    PAD_T + ((hMax - h) / (hMax - hMin)) * (H - PAD_T - PAD_B);

  const terrainLine = pts
    .map((p) => `${x(p.d).toFixed(1)},${y(p.hc).toFixed(1)}`)
    .join(" ");
  const terrainArea = `${x(0).toFixed(1)},${(H - PAD_B).toFixed(1)} ${terrainLine} ${x(D).toFixed(1)},${(H - PAD_B).toFixed(1)}`;

  const fresnel = pts
    .filter((p) => p.d > 0 && p.d < D)
    .map((p) => `${x(p.d).toFixed(1)},${y(p.los - p.r1).toFixed(1)}`)
    .join(" ");

  const gridLines: number[] = [];
  const step = niceStep(hMax - hMin);
  for (let h = Math.ceil(hMin / step) * step; h < hMax; h += step) {
    gridLines.push(h);
  }
  const distStep = niceStep(D) * 2;
  const distTicks: number[] = [];
  for (let d = 0; d <= D + 1; d += distStep) distTicks.push(d);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Профиль трассы — ${SIGNAL_LABELS[q]}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* полоса статуса сверху */}
      <rect
        x={PAD_L}
        y={4}
        width={W - PAD_L - PAD_R}
        height={6}
        rx={2}
        fill={linkColor}
        fillOpacity={0.85}
      />
      <text
        x={PAD_L + 4}
        y={28}
        fontSize="11"
        fontWeight="600"
        fill={linkColor}
      >
        {SIGNAL_LABELS[q]} (двусторонняя связь)
      </text>

      {gridLines.map((h) => (
        <g key={`gh-${h}`}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(h)}
            y2={y(h)}
            stroke="currentColor"
            strokeOpacity="0.1"
          />
          <text
            x={PAD_L - 6}
            y={y(h)}
            fontSize="10"
            textAnchor="end"
            dominantBaseline="middle"
            fill="currentColor"
            fillOpacity="0.55"
          >
            {fmt(h, 0)}
          </text>
        </g>
      ))}

      {distTicks.map((d) => (
        <text
          key={`gd-${d}`}
          x={x(Math.min(d, D))}
          y={H - PAD_B + 16}
          fontSize="10"
          textAnchor="middle"
          fill="currentColor"
          fillOpacity="0.55"
        >
          {fmt(d / 1000, d >= 10000 ? 0 : 1)}
        </text>
      ))}
      <text
        x={W - PAD_R}
        y={H - PAD_B + 26}
        fontSize="10"
        textAnchor="end"
        fill="currentColor"
        fillOpacity="0.45"
      >
        км
      </text>

      <polygon points={fresnel} fill={linkColor} fillOpacity="0.1" />
      <polygon points={terrainArea} fill="currentColor" fillOpacity="0.16" />
      <polyline
        points={terrainLine}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.85"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />

      {pts
        .filter((p) => !p.valid)
        .map((p, i) => (
          <circle
            key={`gap-${i}`}
            cx={x(p.d)}
            cy={y(p.hc)}
            r="2"
            fill="currentColor"
            fillOpacity="0.35"
          />
        ))}

      {/* линия двусторонней связи */}
      <line
        x1={x(0)}
        y1={y(link.h1AbsM)}
        x2={x(D)}
        y2={y(link.h2AbsM)}
        stroke={linkColor}
        strokeWidth="2.2"
        strokeOpacity="0.95"
        strokeDasharray={link.diff.loss > 0 ? "7 4" : undefined}
      />

      {/* антенны станций A / B (обе — приёмопередатчики) */}
      {(
        [
          { d: 0, h: link.h1AbsM, terr: link.txTerrainM, label: "A" },
          { d: D, h: link.h2AbsM, terr: link.rxTerrainM, label: "B" },
        ] as const
      ).map((a, i) => (
        <g key={`ant-${i}`}>
          <line
            x1={x(a.d)}
            y1={y(a.terr)}
            x2={x(a.d)}
            y2={y(a.h)}
            stroke={linkColor}
            strokeWidth="2"
            strokeOpacity="0.95"
          />
          <polygon
            points={`${x(a.d)},${y(a.h)} ${x(a.d) - (i === 0 ? -5 : 5)},${y(a.h) + 9} ${x(a.d) + (i === 0 ? -5 : 5)},${y(a.h) + 9}`}
            fill={linkColor}
            fillOpacity="0.95"
          />
          <text
            x={x(a.d) + (i === 0 ? 10 : -10)}
            y={y(a.h) - 4}
            fontSize="11"
            fontWeight="700"
            textAnchor={i === 0 ? "start" : "end"}
            fill={linkColor}
          >
            {a.label}
          </text>
        </g>
      ))}

      {link.obstacles.map((o, i) => (
        <circle
          key={`obs-${i}`}
          cx={x(o.dM)}
          cy={y(o.hM)}
          r="3.5"
          fill={SIGNAL_COLORS.red}
          fillOpacity="0.85"
          stroke={SIGNAL_COLORS.red}
          strokeWidth="1"
        />
      ))}

      {/* легенда */}
      <g transform={`translate(${PAD_L}, ${H - 8})`}>
        {(
          [
            ["green", SIGNAL_LABELS.green],
            ["yellow", SIGNAL_LABELS.yellow],
            ["red", SIGNAL_LABELS.red],
          ] as const
        ).map(([k, label], i) => (
          <g key={k} transform={`translate(${i * 150}, 0)`}>
            <rect width="8" height="8" y={-8} rx="1" fill={SIGNAL_COLORS[k]} />
            <text x="12" y="0" fontSize="9" fill="currentColor" fillOpacity="0.65">
              {label}
            </text>
          </g>
        ))}
      </g>
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
