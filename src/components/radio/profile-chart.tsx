// Вертикальный разрез трассы: рельеф (с учётом кривизны Земли), линия
// визирования, первая зона Френеля, препятствия и отметки антенн.
// Чистый SVG, детерминированный рендер (без клиентских измерений).

import { fmt } from "@/lib/radio/format";
import type { LinkResult } from "@/lib/radio/engine";

const W = 880;
const H = 320;
const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 14;
const PAD_B = 30;

interface ProfileChartProps {
  link: LinkResult;
  className?: string;
}

export function ProfileChart({ link, className }: ProfileChartProps) {
  const D = link.distanceM;
  const pts = link.pts;

  let hMin = Infinity;
  let hMax = -Infinity;
  for (const p of pts) {
    hMin = Math.min(hMin, p.hc);
    hMax = Math.max(hMax, p.hc, p.los + 10);
    const lower = p.los - p.r1;
    if (p.d > 0 && p.d < D) hMin = Math.min(hMin, lower);
  }
  hMin = Math.min(hMin, Math.min(link.h1AbsM, link.h2AbsM) - 20);
  hMax = Math.max(hMax, Math.max(link.h1AbsM, link.h2AbsM) + 20);
  const span = Math.max(50, hMax - hMin);
  hMax += span * 0.08;
  hMin -= span * 0.05;

  const x = (d: number) => PAD_L + (d / D) * (W - PAD_L - PAD_R);
  const y = (h: number) =>
    PAD_T + ((hMax - h) / (hMax - hMin)) * (H - PAD_T - PAD_B);

  // Рельеф: полигон до нижней кромки (с учётом кривизны — hc).
  const terrainLine = pts.map((p) => `${x(p.d).toFixed(1)},${y(p.hc).toFixed(1)}`).join(" ");
  const terrainArea = `${x(0).toFixed(1)},${(H - PAD_B).toFixed(1)} ${terrainLine} ${x(D).toFixed(1)},${(H - PAD_B).toFixed(1)}`;

  // Нижняя граница первой зоны Френеля.
  const fresnel = pts
    .filter((p) => p.d > 0 && p.d < D)
    .map((p) => `${x(p.d).toFixed(1)},${y(p.los - p.r1).toFixed(1)}`)
    .join(" ");

  // Сетка высот: 4–5 линий.
  const gridLines: number[] = [];
  const step = niceStep(hMax - hMin);
  for (let h = Math.ceil(hMin / step) * step; h < hMax; h += step) {
    gridLines.push(h);
  }

  // Метки расстояний по оси X.
  const distStep = niceStep(D) * 2;
  const distTicks: number[] = [];
  for (let d = 0; d <= D + 1; d += distStep) distTicks.push(d);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Профиль рельефа по трассе"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* сетка высот */}
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

      {/* ось расстояний */}
      {distTicks.map((d) => (
        <text
          key={`gd-${d}`}
          x={x(d)}
          y={H - PAD_B + 14}
          fontSize="10"
          textAnchor="middle"
          fill="currentColor"
          fillOpacity="0.55"
        >
          {fmt(d / 1000, d === 0 || distStep >= 10000 ? 0 : 1)}
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
        км от ПРД
      </text>

      {/* зона Френеля */}
      <polygon points={fresnel} fill="currentColor" fillOpacity="0.07" />

      {/* рельеф */}
      <polygon points={terrainArea} fill="currentColor" fillOpacity="0.16" />
      <polyline
        points={terrainLine}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.85"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />

      {/* разрывы данных HGT */}
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

      {/* линия визирования */}
      <line
        x1={x(0)}
        y1={y(link.h1AbsM)}
        x2={x(D)}
        y2={y(link.h2AbsM)}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeOpacity="0.8"
        strokeDasharray={link.diff.loss > 0 ? "6 4" : undefined}
      />

      {/* антенны */}
      {[{ d: 0, h: link.h1AbsM, terr: link.txTerrainM }, { d: D, h: link.h2AbsM, terr: link.rxTerrainM }].map(
        (a, i) => (
          <g key={`ant-${i}`}>
            <line
              x1={x(a.d)}
              y1={y(a.terr)}
              x2={x(a.d)}
              y2={y(a.h)}
              stroke="currentColor"
              strokeWidth="2"
              strokeOpacity="0.9"
            />
            <polygon
              points={`${x(a.d)},${y(a.h)} ${x(a.d) - (i === 0 ? -5 : 5)},${y(a.h) + 9} ${x(a.d) + (i === 0 ? -5 : 5)},${y(a.h) + 9}`}
              fill="currentColor"
              fillOpacity="0.9"
            />
          </g>
        )
      )}

      {/* препятствия (v > 0) */}
      {link.obstacles.map((o, i) => (
        <circle
          key={`obs-${i}`}
          cx={x(o.dM)}
          cy={y(o.hM)}
          r="3"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.8"
          strokeWidth="1.2"
        />
      ))}
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
