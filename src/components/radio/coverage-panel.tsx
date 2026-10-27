"use client";

// Панель «Зона двусторонней связи вокруг станции A» (Фаза 1, задача 1.1).
// Тяжёлый скан coverage — единственный effect с дебаунсом 300 мс; результат
// пишется в стор, чтобы другие компоненты не запускали повторные сканы.

import { useEffect } from "react";

import { CoverageChart } from "@/components/radio/coverage-chart";
import { Metric, Placeholder } from "@/components/radio/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requestCoverage } from "@/lib/radio/engine-client";
import { ANALYSIS_KM } from "@/lib/radio/form";
import { fmt } from "@/lib/radio/format";
import { useCalculatorStore, useDerived } from "@/lib/radio/calculator-store";

export function CoveragePanel() {
  const d = useDerived();
  const radiusKm = useCalculatorStore((s) => s.radiusKm);
  const setRadiusKm = useCalculatorStore((s) => s.setRadiusKm);
  const coverage = useCalculatorStore((s) => s.coverage);
  const tilesKey = useCalculatorStore((s) => [...s.tiles.keys()].join("|"));
  const coverageBusy = useCalculatorStore((s) => s.coverageBusy);
  const setCoverage = useCalculatorStore((s) => s.setCoverage);
  const setCoverageBusy = useCalculatorStore((s) => s.setCoverageBusy);
  const freqMode = useCalculatorStore((s) => s.freqMode);

  // --- зона покрытия: тяжёлый скан после паузы (дебаунс 300 мс) ---
  useEffect(() => {
    if (!d.txWgs || !d.coverageParams || !d.txTileReady) {
      const reset = setTimeout(() => {
        setCoverage(null);
        setCoverageBusy(false);
      }, 0);
      return () => clearTimeout(reset);
    }
    const wgs = d.txWgs;
    const p = d.coverageParams;
    const t = useCalculatorStore.getState().tiles;
    const r = radiusKm;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setCoverageBusy(true);
      requestCoverage({
        tiles: t,
        txWgs: wgs,
        params: p,
        analysisKm: r,
        signal: ctrl.signal,
      })
        .then((res) => {
          if (!ctrl.signal.aborted) setCoverage(res);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setCoverage(null);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setCoverageBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
     
  }, [d.txWgs, d.coverageParams, tilesKey, radiusKm, d.txTileReady, setCoverage, setCoverageBusy]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Зона двусторонней связи вокруг станции A</CardTitle>
            <CardDescription>
              Центр — передатчик; север сверху; граница = запас на входе ПРМ ≥{" "}
              {d.params ? fmt(d.params.fadeMarginDb, 0) : "—"} дБ
              {freqMode === "range" && d.parsed.txFRangeValid
                ? `; частота ${fmt(d.parsed.txFMax, 0)} МГц (худший случай)`
                : ""}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Радиус анализа</span>
            <Select value={String(radiusKm)} onValueChange={(v) => setRadiusKm(Number(v))}>
              <SelectTrigger className="h-8 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANALYSIS_KM.map((km) => (
                  <SelectItem key={km} value={String(km)}>
                    {km} км
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!d.txOk || !d.params ? (
          <Placeholder text="Введите корректные координаты ПРД и параметры — диаграмма построится автоматически." />
        ) : !d.txTileReady ? (
          <Placeholder
            text={`Нужен файл ${d.txTileName}.hgt — рельеф в точке передатчика. Загрузите его в панели «Рельеф».`}
            warning
          />
        ) : coverageBusy && !coverage ? (
          <Placeholder text="Расчёт зоны покрытия…" />
        ) : coverage ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_190px]">
            <CoverageChart
              coverage={coverage}
              geom={d.geom}
              beamWidthDeg={d.beamWidth}
              className="mx-auto w-full max-w-[460px] text-foreground"
            />
            <dl className="space-y-2.5 self-center text-sm">
              <Metric label="Площадь зоны" value={`${fmt(coverage.areaKm2, 1)} км²`} />
              <Metric
                label="Лучший азимут"
                value={`${fmt(coverage.bestAz, 0)}° — ${fmt(coverage.bestKm, 1)} км`}
              />
              <Metric
                label="Худший азимут"
                value={`${fmt(coverage.worstAz, 0)}° — ${fmt(coverage.worstKm, 1)} км`}
              />
              {coverage.limitHits > 0 && (
                <Metric
                  label="Упёрлись в радиус анализа"
                  value={`${coverage.limitHits} из 72`}
                />
              )}
              {coverage.dataHits > 0 && (
                <Metric label="Без данных HGT" value={`${coverage.dataHits} из 72`} />
              )}
              {d.beamWidth > 0 && d.beamWidth < 360 && (
                <Metric label="Ширина луча" value={`${fmt(d.beamWidth, 0)}°`} />
              )}
              <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                {d.rxOk
                  ? "Пунктир — линия на ПРМ; сплошной кружок — приёмник."
                  : "Без координат ПРМ — только зона вокруг передатчика."}
              </p>
            </dl>
          </div>
        ) : (
          <Placeholder text="Зона покрытия не рассчитана." warning />
        )}
      </CardContent>
    </Card>
  );
}

