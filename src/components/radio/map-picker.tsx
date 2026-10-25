"use client";

// Карта выбора точек A/B и отображения траектории B.
// Leaflet подключается динамически (только в браузере);
// слои: «Схема» — Google Map, «Спутник» — Google Satellite,
// «Гибрид» — Google Hybrid.
// Координаты кликов — WGS-84; перевод в СК-42 выполняет родительский компонент.

import type * as LType from "leaflet";
import { Crosshair, Map as MapIcon, Satellite, TowerControl } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import "leaflet/dist/leaflet.css";

export type MapLayerKind = "scheme" | "sat" | "hybrid";

interface MapPickerProps {
  tx: { lat: number; lon: number } | null;
  rx: { lat: number; lon: number } | null;
  trajectory?: Array<{
    lat: number;
    lon: number;
    status: "ok" | "data" | "error" | null;
  }>;
  pickMode: "tx" | "rx";
  onPick: (lat: number, lon: number) => void;
  onChangePickMode?: () => void;
  className?: string;
}

/** Google Maps tile URLs (не требуют API-ключа для базового доступа). */
const TILE_URLS: Record<MapLayerKind, string> = {
  scheme: "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
  sat: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
  hybrid: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
};

const LAYER_LABEL: Record<MapLayerKind, string> = {
  scheme: "Схема",
  sat: "Спутник",
  hybrid: "Гибрид",
};

const ATTR_GOOGLE =
  '&copy; <a href="https://www.google.com/maps">Google</a>';

const STATUS_COLOR: Record<"ok" | "data" | "error", string> = {
  ok: "#16a34a",
  data: "#9ca3af",
  error: "#dc2626",
};

function makeDivIcon(
  L: typeof LType,
  letter: string,
  color: string
): LType.DivIcon {
  return L.divIcon({
    className: "",
    html: `<svg width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="11.5" fill="${color}" fill-opacity="0.9" stroke="#ffffff" stroke-width="2"/><text x="14" y="18" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif">${letter}</text></svg>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export function MapPicker({
  tx,
  rx,
  trajectory,
  pickMode,
  onPick,
  onChangePickMode,
  className,
}: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const tileLayerRef = useRef<LType.TileLayer | null>(null);
  const txMarkerRef = useRef<LType.Marker | null>(null);
  const rxMarkerRef = useRef<LType.Marker | null>(null);
  const trajLayerRef = useRef<LType.LayerGroup | null>(null);
  const onPickRef = useRef(onPick);
  const [ready, setReady] = useState(false);
  const [layer, setLayer] = useState<MapLayerKind>("scheme");

  // Держим ссылку на самый свежий колбэк onPick (паттерн "latest ref"),
  // чтобы обработчики клика карты не замыкались на устаревшей версии.
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  // --- Инициализация карты (только на клиенте) ---
  useEffect(() => {
    let disposed = false;
    let map: LType.Map | null = null;
    void (async () => {
      const L = (await import("leaflet")) as unknown as typeof LType;
      if (disposed || !containerRef.current || mapRef.current) return;

      map = L.map(containerRef.current, {
        center: [55.7558, 37.6173], // Москва
        zoom: 9,
        zoomControl: true,
        attributionControl: true,
      });
      mapRef.current = map;

      tileLayerRef.current = L.tileLayer(TILE_URLS.scheme, {
        maxZoom: 20,
        attribution: ATTR_GOOGLE,
      }).addTo(map);

      trajLayerRef.current = L.layerGroup().addTo(map);

      map.on("click", (e: LType.LeafletMouseEvent) => {
        onPickRef.current(e.latlng.lat, e.latlng.lng);
      });

      setReady(true);
    })();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      txMarkerRef.current = null;
      rxMarkerRef.current = null;
      trajLayerRef.current = null;
    };
  }, []);

  // --- Переключение слоёв ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // Динамический импорт L для доступа к L.tileLayer
    void (async () => {
      const L = (await import("leaflet")) as unknown as typeof LType;
      if (tileLayerRef.current) {
        map.removeLayer(tileLayerRef.current);
        tileLayerRef.current = null;
      }
      tileLayerRef.current = L.tileLayer(TILE_URLS[layer], {
        maxZoom: 20,
        attribution: ATTR_GOOGLE,
      }).addTo(map);
    })();
  }, [layer, ready]);

  // --- Маркеры A/B ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    void (async () => {
      const L = (await import("leaflet")) as unknown as typeof LType;

      const setMarker = (
        ref: React.MutableRefObject<LType.Marker | null>,
        pos: { lat: number; lon: number } | null,
        letter: string,
        color: string,
        title: string
      ) => {
        if (ref.current) {
          map.removeLayer(ref.current);
          ref.current = null;
        }
        if (pos) {
          const m = L.marker([pos.lat, pos.lon], {
            icon: makeDivIcon(L, letter, color),
            draggable: true,
            title,
          }).addTo(map);
          m.on("dragend", () => {
            const p = m.getLatLng();
            onPickRef.current(p.lat, p.lng);
          });
          m.bindTooltip(
            `${title}: ${pos.lat.toFixed(5)}°, ${pos.lon.toFixed(5)}° (WGS-84)`,
            { direction: "top", offset: [0, -14] }
          );
          ref.current = m;
        }
      };

      setMarker(txMarkerRef, tx, "TX", "#16a34a", "A");
      setMarker(rxMarkerRef, rx, "RX", "#2563eb", "B");
    })();
  }, [tx, rx, ready]);

  // --- Траектория B ---
  useEffect(() => {
    const map = mapRef.current;
    const group = trajLayerRef.current;
    if (!map || !group || !ready) return;
    void (async () => {
      const L = (await import("leaflet")) as unknown as typeof LType;
      group.clearLayers();

      if (trajectory && trajectory.length > 0) {
        const pts = trajectory.map((p) => [p.lat, p.lon] as [number, number]);
        L.polyline(pts, {
          color: "#f59e0b",
          weight: 2,
          opacity: 0.85,
          dashArray: "6 4",
        }).addTo(group);

        trajectory.forEach((p, i) => {
          const color =
            p.status === null ? "#f59e0b" : STATUS_COLOR[p.status];
          L.circleMarker([p.lat, p.lon], {
            radius: i === 0 || i === trajectory.length - 1 ? 5 : 3,
            color: "#ffffff",
            weight: 1,
            fillColor: color,
            fillOpacity: 0.95,
          })
            .bindTooltip(
              `№${i + 1}: ${p.lat.toFixed(5)}°, ${p.lon.toFixed(5)}° (WGS-84)`,
              { direction: "top" }
            )
            .addTo(group);
        });
        map.fitBounds(L.latLngBounds(pts).pad(0.15), { animate: false });
      }
    })();
  }, [trajectory, ready]);

  // --- Курсор при выборе точки ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getContainer().style.cursor = "crosshair";
    return () => {
      if (mapRef.current) mapRef.current.getContainer().style.cursor = "";
    };
  }, [pickMode, ready]);

  // --- Центрирование на последней установленной точке ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const target =
      pickMode === "tx" ? tx : rx;
    if (target) {
      map.setView([target.lat, target.lon], map.getZoom(), { animate: true });
    }
  }, [pickMode === "tx" ? tx?.lat : rx?.lat, ready]);

  const hasTrajectory = trajectory !== undefined && trajectory.length > 1;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Панель управления слоями и режимом выбора */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
          {(Object.keys(LAYER_LABEL) as MapLayerKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setLayer(kind)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                layer === kind
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {kind === "scheme" ? (
                <MapIcon className="h-3.5 w-3.5" />
              ) : (
                <Satellite className="h-3.5 w-3.5" />
              )}
              {LAYER_LABEL[kind]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Crosshair className="h-3.5 w-3.5" />
          <span>Клик задаёт</span>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 px-1.5 text-xs font-medium",
              pickMode === "tx"
                ? "text-green-600 hover:text-green-700"
                : "text-blue-600 hover:text-blue-700"
            )}
            onClick={onChangePickMode}
          >
            {pickMode === "tx" ? "A" : "B"}
          </Button>
        </div>
      </div>

      {/* Контейнер карты */}
      <div className="relative overflow-hidden rounded-lg border">
        <div ref={containerRef} className="h-[400px] w-full" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50 text-sm text-muted-foreground">
            Загрузка карты…
          </div>
        )}
        {hasTrajectory && (
          <div className="absolute bottom-2 left-2 z-[400] rounded-md border bg-background/90 px-2 py-1 text-[11px] shadow-sm">
            <span className="mr-2 inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
              связь есть
            </span>
            <span className="mr-2 inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
              нет данных HGT
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-red-600" />
              ошибка
            </span>
          </div>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <TowerControl className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Точки задаются кликом (или перетаскиванием маркера TX/RX) и
        пересчитываются в СК-42 автоматически. Координаты карты — WGS-84.
      </p>
    </div>
  );
}
