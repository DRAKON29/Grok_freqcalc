"use client";

// Вертикальный разрез трассы: рельеф, линия визирования, зона Френеля.
// Цвет линии связи — по качеству двустороннего канала.
//
// Интерактив (задача 3.7):
// - зум колесом мыши / щипком (pinch) вокруг курсора;
// - панорамирование перетаскиванием;
// - двойной клик / кнопка «Сброс» — возврат вида;
// - слайдер вертикального преувеличения (VEx);
// - кнопка «Развернуть» — увеличенный просмотр в диалоге;
// - экспорт видимого участка в SVG и PNG.

import { useCallback, useRef, useState } from "react";
import {
  Download,
  Maximize2,
  MousePointer2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { fmt } from "@/lib/radio/format";
import type { LinkResult } from "@/lib/radio/engine";
import {
  SIGNAL_COLORS,
  SIGNAL_LABELS,
  signalQuality,
} from "@/lib/radio/signal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const W = 880;
const H = 320;
const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 14;
const PAD_B = 30;

const MIN_ZOOM = 1;
const MAX_ZOOM = 64;

interface View {
  zx: number; // горизонтальный зум
  zy: number; // вертикальный зум
  cx: number; // центр окна, доля дистанции [0..1]
  cy: number; // центр окна, нормализованная высота [0..1]
}

const BASE_VIEW: View = { zx: 1, zy: 1, cx: 0.5, cy: 0.5 };

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
  const [view, setView] = useState<View>(BASE_VIEW);
  const [vex, setVex] = useState(1);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{ dist: number } | null>(null);

  const reset = useCallback(() => {
    setView(BASE_VIEW);
    setVex(1);
  }, []);

  // Клиентские координаты -> нормализованные координаты области построения.
  const toPlot = useCallback(
    (clientX: number, clientY: number, vw = W, vh = H) => {
      const el = svgRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      const s = Math.min(r.width / vw, r.height / vh);
      const vx = (clientX - r.left - (r.width - vw * s) / 2) / s;
      const vy = (clientY - r.top - (r.height - vh * s) / 2) / s;
      return {
        fx: clamp((vx - PAD_L) / (vw - PAD_L - PAD_R), 0, 1),
        fy: clamp(1 - (vy - PAD_T) / (vh - PAD_T - PAD_B), 0, 1),
      };
    },
    [],
  );

  const zoomAt = useCallback(
    (factorX: number, factorY: number, fx: number, fy: number) => {
      setView((v) => {
        const zx = clamp(v.zx * factorX, MIN_ZOOM, MAX_ZOOM);
        const zy = clamp(v.zy * factorY, MIN_ZOOM, MAX_ZOOM);
        // точка под курсором остаётся на месте
        const cx = fx + (v.cx - 0.5) * (v.zx / zx);
        const cy = fy + (v.cy - 0.5) * (v.zy / zy);
        return { zx, zy, cx: clamp(cx, 0, 1), cy: clamp(cy, 0, 1) };
      });
    },
    [],
  );

  const panByPixels = useCallback(
    (dxPx: number, dyPx: number, vw = W, vh = H) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const s = Math.min(r.width / vw, r.height / vh);
      if (s === 0) return;
      setView((v) => ({
        ...v,
        cx: clamp(v.cx - dxPx / s / (vw - PAD_L - PAD_R) / v.zx, 0, 1),
        cy: clamp(v.cy + dyPx / s / (vh - PAD_T - PAD_B) / v.zy, 0, 1),
      }));
    },
    [],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      const p = toPlot(e.clientX, e.clientY);
      if (!p) return;
      const factor = Math.exp(-e.deltaY * 0.0015);
      // Shift+колесо — только вертикаль; Ctrl/Cmd+колесо — только горизонталь
      let fx = factor;
      let fy = factor;
      if (e.shiftKey) fx = 1;
      if (e.ctrlKey || e.metaKey) fy = 1;
      zoomAt(fx, fy, p.fx, p.fy);
    },
    [toPlot, zoomAt],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.pointerType === "touch") return; // жесты — через touch-обработчики
      dragRef.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const d = dragRef.current;
      if (!d || e.pointerType === "touch") return;
      panByPixels(e.clientX - d.x, e.clientY - d.y);
      dragRef.current = { x: e.clientX, y: e.clientY };
    },
    [panByPixels],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const touchDist = (t: React.TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  const handleTouchStart = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 2) {
      pinchRef.current = { dist: touchDist(e.touches) };
      dragRef.current = null;
    } else if (e.touches.length === 1) {
      dragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<SVGSVGElement>) => {
      if (e.touches.length === 2 && pinchRef.current) {
        const nd = touchDist(e.touches);
        const od = pinchRef.current.dist;
        if (od > 0 && nd > 0) {
          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const p = toPlot(midX, midY);
          if (p) zoomAt(nd / od, nd / od, p.fx, p.fy);
          pinchRef.current = { dist: nd };
        }
      } else if (e.touches.length === 1 && dragRef.current) {
        panByPixels(
          e.touches[0].clientX - dragRef.current.x,
          e.touches[0].clientY - dragRef.current.y,
        );
        dragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    },
    [panByPixels, toPlot, zoomAt],
  );

  const handleTouchEnd = useCallback(() => {
    dragRef.current = null;
    pinchRef.current = null;
  }, []);

  const isZoomed = view.zx !== 1 || view.zy !== 1 || vex !== 1;

  return (
    <div className="flex flex-col gap-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Профиль трассы — ${SIGNAL_LABELS[signalQuality(link.marginDb, fadeMarginDb)]}. Колесо мыши — масштаб, перетаскивание — панорама, двойной клик — сброс.`}
        className={`${className ?? ""} cursor-grab touch-none select-none active:cursor-grabbing`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={reset}
      >
        <ProfileScene
          link={link}
          fadeMarginDb={fadeMarginDb}
          view={view}
          vex={vex}
          width={W}
          height={H}
        />
      </svg>

      {/* панель управления видом */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={() => zoomAt(1 / 1.5, 1 / 1.5, 0.5, 0.5)}
            aria-label="Отдалить"
            title="Отдалить"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="w-14 text-center tabular-nums">
            ×{fmt(Math.sqrt(view.zx * view.zy), 1)}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={() => zoomAt(1.5, 1.5, 0.5, 0.5)}
            aria-label="Приблизить"
            title="Приблизить"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={reset}
            disabled={!isZoomed}
            title="Сбросить зум и VEx (или двойной клик по графику)"
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Сброс
          </Button>
        </div>

        <label
          className="flex items-center gap-2"
          title="Вертикальное преувеличение рельефа"
        >
          VEx
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={vex}
            onChange={(e) => setVex(Number(e.target.value))}
            className="w-24 accent-current"
          />
          <span className="w-8 tabular-nums">×{fmt(vex, 1)}</span>
        </label>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 px-2">
              <Maximize2 className="mr-1 h-3.5 w-3.5" />
              Развернуть
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[95vw] sm:max-w-[1200px]">
            <DialogHeader>
              <DialogTitle>Профиль трассы — увеличенный вид</DialogTitle>
              <DialogDescription>
                Колесо мыши — зум вокруг курсора (Shift — только по высоте,
                Ctrl — только по дистанции), перетаскивание — панорама, двойной
                клик — сброс.
              </DialogDescription>
            </DialogHeader>
            <ExpandedProfileView link={link} fadeMarginDb={fadeMarginDb} />
          </DialogContent>
        </Dialog>

        <ExportMenu svgRef={svgRef} distanceM={link.distanceM} />

        {!isZoomed && (
          <span className="hidden items-center gap-1 lg:flex">
            <MousePointer2 className="h-3 w-3 opacity-60" />
            колесо — зум · перетащить — панорама · двойной клик — сброс
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Увеличенный просмотр: крупнее + независимый зум/VEx                 */
/* ------------------------------------------------------------------ */

const EW = 1400;
const EH = 620;

function ExpandedProfileView({
  link,
  fadeMarginDb,
}: {
  link: LinkResult;
  fadeMarginDb: number;
}) {
  const [view, setView] = useState<View>(BASE_VIEW);
  const [vex, setVex] = useState(1);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    setView(BASE_VIEW);
    setVex(1);
  }, []);

  const toPlot = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const s = Math.min(r.width / EW, r.height / EH);
    const vx = (clientX - r.left - (r.width - EW * s) / 2) / s;
    const vy = (clientY - r.top - (r.height - EH * s) / 2) / s;
    return {
      fx: clamp((vx - PAD_L) / (EW - PAD_L - PAD_R), 0, 1),
      fy: clamp(1 - (vy - PAD_T) / (EH - PAD_T - PAD_B), 0, 1),
    };
  }, []);

  const zoomAt = useCallback(
    (factorX: number, factorY: number, fx: number, fy: number) => {
      setView((v) => {
        const zx = clamp(v.zx * factorX, MIN_ZOOM, MAX_ZOOM);
        const zy = clamp(v.zy * factorY, MIN_ZOOM, MAX_ZOOM);
        return {
          zx,
          zy,
          cx: clamp(fx + (v.cx - 0.5) * (v.zx / zx), 0, 1),
          cy: clamp(fy + (v.cy - 0.5) * (v.zy / zy), 0, 1),
        };
      });
    },
    [],
  );

  const panByPixels = useCallback((dxPx: number, dyPx: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / EW, r.height / EH);
    if (s === 0) return;
    setView((v) => ({
      ...v,
      cx: clamp(v.cx - dxPx / s / (EW - PAD_L - PAD_R) / v.zx, 0, 1),
      cy: clamp(v.cy + dyPx / s / (EH - PAD_T - PAD_B) / v.zy, 0, 1),
    }));
  }, []);

  const visibleKm = `${fmt((view.cx - 0.5 / view.zx) * link.distanceM / 1000, 1)}–${fmt(
    (view.cx + 0.5 / view.zx) * link.distanceM / 1000,
    1,
  )} км`;

  return (
    <div className="flex flex-col gap-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${EW} ${EH}`}
        className="w-full cursor-grab touch-none select-none text-foreground active:cursor-grabbing"
        preserveAspectRatio="xMidYMid meet"
        onWheel={(e) => {
          const p = toPlot(e.clientX, e.clientY);
          if (!p) return;
          const factor = Math.exp(-e.deltaY * 0.0015);
          zoomAt(
            e.shiftKey ? 1 : factor,
            e.ctrlKey || e.metaKey ? 1 : e.shiftKey ? factor : factor,
            p.fx,
            p.fy,
          );
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") return;
          dragRef.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d || e.pointerType === "touch") return;
          panByPixels(e.clientX - d.x, e.clientY - d.y);
          dragRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (dragRef.current = null)}
        onPointerLeave={() => (dragRef.current = null)}
        onDoubleClick={reset}
      >
        <ProfileScene
          link={link}
          fadeMarginDb={fadeMarginDb}
          view={view}
          vex={vex}
          width={EW}
          height={EH}
        />
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-2" title="Вертикальное преувеличение рельефа">
          VEx
          <input
            type="range"
            min={1}
            max={20}
            step={0.5}
            value={vex}
            onChange={(e) => setVex(Number(e.target.value))}
            className="w-32 accent-current"
          />
          <span className="w-8 tabular-nums">×{fmt(vex, 1)}</span>
        </label>
        <span>
          зум ×{fmt(Math.sqrt(view.zx * view.zy), 1)} · участок {visibleKm}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={reset}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Сброс
        </Button>
        <ExportMenu svgRef={svgRef} distanceM={link.distanceM} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Экспорт текущего вида (SVG/PNG)                                     */
/* ------------------------------------------------------------------ */

function ExportMenu({
  svgRef,
  distanceM,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  distanceM: number;
}) {
  const [open, setOpen] = useState(false);

  const buildSvgString = useCallback((): string | null => {
    const src = svgRef.current;
    if (!src) return null;
    const vb = src.viewBox.baseVal;
    const w = vb.width || W;
    const h = vb.height || H;
    const clone = src.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    // currentColor -> фактический цвет текста; фон — белый для читаемости
    clone.style.color = getComputedStyle(src).color || "#111";
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", String(w));
    bg.setAttribute("height", String(h));
    bg.setAttribute("fill", "#ffffff");
    clone.insertBefore(bg, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }, [svgRef]);

  const download = (url: string, name: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const baseName = `profile-${Math.round(distanceM / 1000)}km`;

  const exportSvg = () => {
    const str = buildSvgString();
    if (!str) return;
    const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml" }));
    download(url, `${baseName}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setOpen(false);
  };

  const exportPng = (scale = 3) => {
    const str = buildSvgString();
    if (!str) return;
    const src = svgRef.current;
    const vb = src?.viewBox.baseVal;
    const w = vb?.width || W;
    const h = vb?.height || H;
    const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      download(canvas.toDataURL("image/png"), `${baseName}.png`);
      setOpen(false);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Экспорт видимого участка"
      >
        <Download className="mr-1 h-3.5 w-3.5" />
        Экспорт
      </Button>
      {open && (
        <div className="absolute left-0 top-8 z-10 flex flex-col rounded-md border bg-background p-1 shadow-md">
          <button
            className="rounded px-3 py-1.5 text-left hover:bg-accent"
            onClick={exportSvg}
          >
            SVG (вектор)
          </button>
          <button
            className="rounded px-3 py-1.5 text-left hover:bg-accent"
            onClick={() => exportPng(3)}
          >
            PNG ×3
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Собственно сцена профиля (SVG-содержимое без обёртки <svg>)         */
/* ------------------------------------------------------------------ */

interface SceneProps {
  link: LinkResult;
  fadeMarginDb: number;
  view: View;
  vex: number;
  width: number;
  height: number;
}

function ProfileScene({
  link,
  fadeMarginDb,
  view,
  vex,
  width: Wv,
  height: Hv,
}: SceneProps) {
  const D = link.distanceM;
  const pts = link.pts;
  const q = signalQuality(link.marginDb, fadeMarginDb);
  const linkColor = SIGNAL_COLORS[q];

  // Базовые границы высот — как в статичной версии.
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

  // VEx растягивает высоты вокруг середины диапазона.
  const hMid = (hMax + hMin) / 2;
  const applyVex = (h: number) => hMid + (h - hMid) * vex;
  const hMinV = applyVex(hMin);
  const hMaxV = applyVex(hMax);
  const hSpanV = hMaxV - hMinV;

  // Окно просмотра в координатах данных.
  const dLo = (view.cx - 0.5 / view.zx) * D;
  const dHi = (view.cx + 0.5 / view.zx) * D;
  const hLo = hMid - hSpanV / 2 / view.zy + (view.cy - 0.5) * (hSpanV / view.zy);
  const hHi = hLo + hSpanV / view.zy;

  const plotW = Wv - PAD_L - PAD_R;
  const plotH = Hv - PAD_T - PAD_B;

  const x = (d: number) => PAD_L + ((d - dLo) / (dHi - dLo)) * plotW;
  const y = (h: number) => PAD_T + ((hHi - applyVex(h)) / (hHi - hLo)) * plotH;

  // Отрисовываемая часть профиля (с захватом соседних точек для непрерывности).
  const margin = (dHi - dLo) * 0.02;
  const visibleIdx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const d = pts[i].d;
    if (d >= dLo - margin && d <= dHi + margin) visibleIdx.push(i);
  }
  if (visibleIdx.length > 0) {
    if (visibleIdx[0] > 0) visibleIdx.unshift(visibleIdx[0] - 1);
    const last = visibleIdx[visibleIdx.length - 1];
    if (last < pts.length - 1) visibleIdx.push(last + 1);
  }
  const vpts = visibleIdx.map((i) => pts[i]);

  const terrainLine = vpts
    .map((p) => `${x(p.d).toFixed(1)},${y(p.hc).toFixed(1)}`)
    .join(" ");
  const terrainArea =
    vpts.length > 0
      ? `${x(vpts[0].d).toFixed(1)},${(PAD_T + plotH).toFixed(1)} ${terrainLine} ${x(
          vpts[vpts.length - 1].d,
        ).toFixed(1)},${(PAD_T + plotH).toFixed(1)}`
      : "";

  const fresnelPts = vpts.filter((p) => p.d > 0 && p.d < D);
  const fresnel =
    fresnelPts.length > 1
      ? fresnelPts
          .map((p) => `${x(p.d).toFixed(1)},${y(p.los).toFixed(1)}`)
          .join(" ") +
        " " +
        [...fresnelPts]
          .reverse()
          .map((p) => `${x(p.d).toFixed(1)},${y(p.los - p.r1).toFixed(1)}`)
          .join(" ")
      : "";

  // Адаптивные сетки: шаг подбирается под видимый диапазон.
  const gridLines: number[] = [];
  const hStep = niceStep(hHi - hLo);
  for (let h = Math.ceil(hLo / hStep) * hStep; h < hHi; h += hStep) {
    gridLines.push(h);
  }
  const distStep = niceStep(dHi - dLo);
  const distTicks: number[] = [];
  for (
    let d = Math.ceil(Math.max(0, dLo) / distStep) * distStep;
    d <= dHi;
    d += distStep
  ) {
    distTicks.push(d);
  }

  const clipId = `profclip-${Math.round(Wv)}-${Math.round(Hv)}`;

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} />
        </clipPath>
      </defs>

      {/* полоса статуса сверху */}
      <rect
        x={PAD_L}
        y={4}
        width={plotW}
        height={6}
        rx={2}
        fill={linkColor}
        fillOpacity={0.85}
      />
      <text x={PAD_L + 4} y={28} fontSize="11" fontWeight="600" fill={linkColor}>
        {SIGNAL_LABELS[q]} (двусторонняя связь)
      </text>

      {/* сетка высот */}
      {gridLines.map((h) => (
        <g key={`gh-${h.toFixed(1)}`}>
          <line
            x1={PAD_L}
            x2={Wv - PAD_R}
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

      {/* деления дистанции */}
      {distTicks.map((d) => (
        <g key={`gd-${d}`}>
          <line
            x1={x(d)}
            x2={x(d)}
            y1={PAD_T}
            y2={PAD_T + plotH}
            stroke="currentColor"
            strokeOpacity="0.06"
          />
          <text
            x={x(d)}
            y={Hv - PAD_B + 16}
            fontSize="10"
            textAnchor="middle"
            fill="currentColor"
            fillOpacity="0.55"
          >
            {fmt(d / 1000, distStep >= 1000 ? 0 : 1)}
          </text>
        </g>
      ))}
      <text
        x={Wv - PAD_R}
        y={Hv - PAD_B + 26}
        fontSize="10"
        textAnchor="end"
        fill="currentColor"
        fillOpacity="0.45"
      >
        км
      </text>

      {/* данные — в клиппинге, чтобы при зуме не выходили за оси */}
      <g clipPath={`url(#${clipId})`}>
        {fresnel && <polygon points={fresnel} fill={linkColor} fillOpacity="0.1" />}
        {terrainArea && (
          <polygon points={terrainArea} fill="currentColor" fillOpacity="0.16" />
        )}
        {terrainLine && (
          <polyline
            points={terrainLine}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.85"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        )}

        {vpts
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
              points={`${x(a.d)},${y(a.h)} ${x(a.d) - (i === 0 ? -5 : 5)},${
                y(a.h) + 9
              } ${x(a.d) + (i === 0 ? -5 : 5)},${y(a.h) + 9}`}
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
      </g>

      {/* легенда */}
      <g transform={`translate(${PAD_L}, ${Hv - 8})`}>
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
    </>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function niceStep(range: number): number {
  const raw = range / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const norm = raw / pow;
  const mult = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return mult * pow;
}
