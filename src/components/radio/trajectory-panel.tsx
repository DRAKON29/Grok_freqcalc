"use client";

// Панель траектории станции B (Фаза 1, задача 1.1): загрузка .rt, таблица
// точек, результаты evaluateTrajectory из стора.

import { Route, Trash2, TriangleAlert, Upload } from "lucide-react";
import { useRef } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Placeholder } from "@/components/radio/shared";
import { Metric } from "@/components/radio/shared";
import { fmt } from "@/lib/radio/format";
import { tileKeyAt } from "@/lib/radio/hgt";
import { useCalculatorStore, useDerived } from "@/lib/radio/calculator-store";
import { cn } from "@/lib/utils";

export function TrajectoryPanel() {
  const d = useDerived();
  const trajFileRef = useRef<HTMLInputElement>(null);

  const trajectory = useCalculatorStore((s) => s.trajectory);
  const trajectoryResult = useCalculatorStore((s) => s.trajectoryResult);
  const trajectoryBusy = useCalculatorStore((s) => s.trajectoryBusy);
  const trajectoryWarnings = useCalculatorStore((s) => s.trajectoryWarnings);
  const trajectoryError = useCalculatorStore((s) => s.trajectoryError);
  const tiles = useCalculatorStore((s) => s.tiles);
  const useSynthetic = useCalculatorStore((s) => s.useSynthetic);
  const loadTrajectoryFile = useCalculatorStore((s) => s.loadTrajectoryFile);
  const clearTrajectory = useCalculatorStore((s) => s.clearTrajectory);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Route className="h-4 w-4 text-muted-foreground" />
          Траектория станции B
        </CardTitle>
        <CardDescription>
          Файл .rt / JSON: lat, lon и altitude (высота над уровнем моря, м) в
          каждой точке. Высота AMSL используется в расчёте двусторонней связи A↔B.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={trajFileRef}
          type="file"
          accept=".rt,application/json"
          className="hidden"
          onChange={(e) => {
            loadTrajectoryFile(e.target.files);
            if (trajFileRef.current) trajFileRef.current.value = "";
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => trajFileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {trajectory ? "Заменить .rt" : "Загрузить .rt"}
          </Button>
          {trajectory && (
            <>
              <Badge variant="secondary" className="px-2 py-0 text-[11px]">
                {trajectory.fileName} ({trajectory.points.length} точек)
              </Badge>
              <Badge variant="outline" className="px-2 py-0 text-[11px]">
                H AMSL:{" "}
                {fmt(Math.min(...trajectory.points.map((pt) => pt.altitudeM)), 0)}
                …
                {fmt(Math.max(...trajectory.points.map((pt) => pt.altitudeM)), 0)} м
              </Badge>
              {trajectory.tripodHeightM != null && (
                <Badge variant="outline" className="px-2 py-0 text-[11px]">
                  + штатив {fmt(trajectory.tripodHeightM, 1)} м
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-destructive"
                onClick={clearTrajectory}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Очистить
              </Button>
            </>
          )}
        </div>

        {trajectory && !trajectoryResult && !trajectoryBusy && (
          <div className="max-h-40 overflow-y-auto rounded-lg border text-xs">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">№</th>
                  <th className="px-2 py-1.5 font-medium">Широта</th>
                  <th className="px-2 py-1.5 font-medium">Долгота</th>
                  <th className="px-2 py-1.5 font-medium">Высота AMSL</th>
                  <th className="px-2 py-1.5 font-medium">Антенна AMSL</th>
                </tr>
              </thead>
              <tbody>
                {trajectory.points.map((pt, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="px-2 py-1 font-mono">{i + 1}</td>
                    <td className="px-2 py-1 tabular-nums">{fmt(pt.lat, 5)}°</td>
                    <td className="px-2 py-1 tabular-nums">{fmt(pt.lon, 5)}°</td>
                    <td className="px-2 py-1 tabular-nums font-medium">
                      {fmt(pt.altitudeM, 0)} м
                    </td>
                    <td className="px-2 py-1 tabular-nums">
                      {fmt(pt.altitudeM + (trajectory.tripodHeightM ?? 0), 0)} м
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {trajectoryResult?.syntheticUsed && (
          <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>Синтетический рельеф (демо)</AlertTitle>
            <AlertDescription className="text-xs">
              Часть траекторий посчитана по синтетической модели высот —
              реальные данные HGT на этих участках отсутствуют. Результаты не
              пригодны для инженерных решений; загрузите тайлы DEM или
              включите автозагрузку рельефа.
            </AlertDescription>
          </Alert>
        )}

        {trajectory && tiles.size > 0 && d.txWgs && !tiles.has(tileKeyAt(d.txWgs.lat, d.txWgs.lon)) && !useSynthetic && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>Нет HGT у станции A</AlertTitle>
            <AlertDescription className="text-xs">
              Станция A ({fmt(d.txWgs.lat, 4)}°, {fmt(d.txWgs.lon, 4)}°) требует тайл{" "}
              <span className="font-mono">{tileKeyAt(d.txWgs.lat, d.txWgs.lon)}.hgt</span>.
              Сейчас загружены: {[...tiles.keys()].join(", ") || "—"}.
              Укажите координаты A в зоне загруженных тайлов или загрузите нужный .hgt.
            </AlertDescription>
          </Alert>
        )}

        {trajectoryWarnings.length > 0 && (
          <Alert>
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>Предупреждения</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {trajectoryWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {trajectoryError && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>Ошибка</AlertTitle>
            <AlertDescription className="text-xs">{trajectoryError}</AlertDescription>
          </Alert>
        )}

        {trajectoryBusy && <Placeholder text="Расчёт траектории…" />}

        {trajectoryResult && (
          <div className="space-y-3">
            {/* Сводка */}
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={trajectoryResult.okCount > 0 ? "default" : "destructive"}
                className="px-2 py-0 text-[11px]"
              >
                Связь: {trajectoryResult.okCount} из {trajectoryResult.points.length}
              </Badge>
              {trajectoryResult.dataCount > 0 && (
                <Badge variant="secondary" className="px-2 py-0 text-[11px]">
                  Нет HGT на трассе/у A: {trajectoryResult.dataCount}
                </Badge>
              )}
              {trajectoryResult.errorCount > 0 && (
                <Badge variant="destructive" className="px-2 py-0 text-[11px]">
                  Ошибок: {trajectoryResult.errorCount}
                </Badge>
              )}
              {trajectory?.tripodHeightM !== null &&
                trajectory?.tripodHeightM !== undefined && (
                  <Badge variant="outline" className="px-2 py-0 text-[11px]">
                    Штатив: {fmt(trajectory.tripodHeightM, 0)} м
                  </Badge>
                )}
            </div>

            {/* Таблица точек */}
            <div className="max-h-64 overflow-y-auto rounded-lg border text-xs">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">№</th>
                    <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">Широта</th>
                    <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">Долгота</th>
                    <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">H AMSL</th>
                    <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">Дальн.</th>
                    <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">Запас</th>
                    <th className="sticky top-0 bg-muted/95 px-2 py-1.5 font-medium">Ст.</th>
                  </tr>
                </thead>
                <tbody>
                  {trajectoryResult.points.map((p) => (
                    <tr
                      key={p.idx}
                      className={cn(
                        "border-b border-border/40",
                        p.ok
                          ? ""
                          : p.status === "error"
                            ? "bg-destructive/5"
                            : "bg-muted/20"
                      )}
                    >
                      <td className="px-2 py-1 font-mono">{p.idx + 1}</td>
                      <td className="px-2 py-1 tabular-nums">{fmt(p.lat, 4)}°</td>
                      <td className="px-2 py-1 tabular-nums">{fmt(p.lon, 4)}°</td>
                      <td className="px-2 py-1 tabular-nums font-medium">{fmt(p.altitudeM, 0)} м</td>
                      <td className="px-2 py-1 tabular-nums">{fmt(p.distanceM / 1000, 2)} км</td>
                      <td
                        className={cn(
                          "px-2 py-1 tabular-nums font-medium",
                          p.marginDb !== null && p.marginDb >= 0
                            ? "text-green-600"
                            : "text-destructive"
                        )}
                      >
                        {p.marginDb !== null ? fmt(p.marginDb, 1) : "—"}
                      </td>
                      <td className="px-2 py-1">
                        <span
                          className={cn(
                            "inline-block h-2 w-2 rounded-full",
                            p.status === "ok"
                              ? "bg-green-600"
                              : p.status === "data"
                                ? "bg-gray-400"
                                : "bg-red-600"
                          )}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Статистика */}
            {trajectoryResult.points.length > 0 &&
              (trajectoryResult.bestIdx !== null || trajectoryResult.worstIdx !== null) && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {trajectoryResult.bestIdx !== null && (
                    <Metric
                      label="Макс. запас"
                      value={`${fmt(
                        trajectoryResult.points[trajectoryResult.bestIdx].marginDb ?? 0,
                        1
                      )} дБ (точка ${trajectoryResult.bestIdx + 1})`}
                    />
                  )}
                  {trajectoryResult.worstIdx !== null && (
                    <Metric
                      label="Мин. запас"
                      value={`${fmt(
                        trajectoryResult.points[trajectoryResult.worstIdx].marginDb ?? 0,
                        1
                      )} дБ (точка ${trajectoryResult.worstIdx + 1})`}
                    />
                  )}
                </dl>
              )}
          </div>
        )}

        {!trajectory && !trajectoryBusy && !trajectoryError && (
          <Placeholder text="Загрузите .rt (lat, lon, altitude AMSL). Станция A должна быть в зоне загруженных HGT (например N50E036 для маршрута у 50°N 36°E). После загрузки HGT расчёт перезапустится сам." />
        )}
      </CardContent>
    </Card>
  );
}
