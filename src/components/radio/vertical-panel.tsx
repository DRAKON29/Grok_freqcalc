"use client";

// Вертикальный анализ: уровень ПРМ vs высота антенны ПРМ (Фаза 1, задача 1.1).
// Единственный effect с дебаунсом 300 мс; результат — в сторе.

import { ArrowUpDown, Compass } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NumberField } from "@/components/radio/number-field";
import { VerticalChart } from "@/components/radio/vertical-chart";
import { Metric, Placeholder } from "@/components/radio/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requestVertical } from "@/lib/radio/engine-client";
import { VERT_MAX_HM } from "@/lib/radio/form";
import { fmt, parseNum } from "@/lib/radio/format";
import { useCalculatorStore, useDerived } from "@/lib/radio/calculator-store";

export function VerticalPanel() {
  const d = useDerived();
  const values = useCalculatorStore((s) => s.values);
  const setField = useCalculatorStore((s) => s.setField);
  const vertMaxHM = useCalculatorStore((s) => s.vertMaxHM);
  const setVertMaxHM = useCalculatorStore((s) => s.setVertMaxHM);
  const syncVertFromLink = useCalculatorStore((s) => s.syncVertFromLink);
  const tilesKey = useCalculatorStore((s) => [...s.tiles.keys()].join("|"));
  const vertical = useCalculatorStore((s) => s.vertical);
  const verticalBusy = useCalculatorStore((s) => s.verticalBusy);
  const setVertical = useCalculatorStore((s) => s.setVertical);
  const setVerticalBusy = useCalculatorStore((s) => s.setVerticalBusy);

  // --- вертикальный анализ: уровень сигнала vs высота ПРМ ---
  useEffect(() => {
    const distKm = parseNum(values.vertDistKm ?? "");
    const azDeg = parseNum(values.vertAzDeg ?? "");
    if (
      !d.txWgs ||
      !d.params ||
      !d.txTileReady ||
      !Number.isFinite(distKm) ||
      distKm <= 0
    ) {
      const reset = setTimeout(() => {
        setVertical(null);
        setVerticalBusy(false);
      }, 0);
      return () => clearTimeout(reset);
    }
    const wgs = d.txWgs;
    const p = d.params;
    const t = useCalculatorStore.getState().tiles;
    const mx = vertMaxHM;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setVerticalBusy(true);
      requestVertical({
        tiles: t,
        txWgs: wgs,
        azDeg,
        distanceKm: distKm,
        params: p,
        maxHM: mx,
        stepHM: Math.max(0.5, mx / 100),
        signal: ctrl.signal,
      })
        .then((r) => {
          if (!ctrl.signal.aborted) setVertical(r);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setVertical(null);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setVerticalBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
     
  }, [d.txWgs, d.params, tilesKey, d.txTileReady, values.vertDistKm, values.vertAzDeg, vertMaxHM, setVertical, setVerticalBusy]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
              Сигнал по высоте ПРМ
            </CardTitle>
            <CardDescription>
              Уровень на входе ПРМ в зависимости от высоты антенны над рельефом
            </CardDescription>
          </div>
          {d.geom && (
            <Button variant="ghost" size="sm" onClick={syncVertFromLink} className="h-8 shrink-0">
              <Compass className="h-3.5 w-3.5" />
              от трассы
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-[1fr_1fr_auto]">
          <NumberField
            id="vertDistKm"
            label="Дальность"
            unit="км"
            value={values.vertDistKm ?? ""}
            onChange={(v) => setField("vertDistKm", v)}
            hint="от 0,1"
          />
          <NumberField
            id="vertAzDeg"
            label="Азимут"
            unit="°"
            value={values.vertAzDeg ?? ""}
            onChange={(v) => setField("vertAzDeg", v)}
            hint="0…360"
          />
          <div className="space-y-1.5">
            <span className="text-[13px] font-medium leading-none">До высоты</span>
            <Select value={String(vertMaxHM)} onValueChange={(v) => setVertMaxHM(Number(v))}>
              <SelectTrigger className="h-9 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERT_MAX_HM.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h} м
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!d.txOk || !d.params ? (
          <Placeholder text="Введите координаты ПРД и параметры — график построится автоматически." />
        ) : !d.txTileReady ? (
          <Placeholder text={`Нужен файл ${d.txTileName}.hgt — рельеф в точке передатчика.`} warning />
        ) : verticalBusy && !vertical ? (
          <Placeholder text="Расчёт вертикального профиля…" />
        ) : vertical ? (
          <div className="space-y-3">
            <VerticalChart
              result={vertical}
              fadeMarginDb={d.params?.fadeMarginDb ?? 0}
              className="w-full text-foreground"
            />
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Metric
                label="Мин. высота устойчивой связи"
                value={
                  vertical.minHeightM !== null
                    ? `${fmt(vertical.minHeightM, 1)} м`
                    : "нет во всём диапазоне"
                }
              />
              <Metric label="Порог (чувств. + запас)" value={`${fmt(vertical.thresholdDbm, 0)} дБм`} />
              <Metric label="Макс. уровень ПРМ" value={`${fmt(vertical.prxMaxDbm, 1)} дБм`} />
              <Metric label="Мин. уровень ПРМ" value={`${fmt(vertical.prxMinDbm, 1)} дБм`} />
              <Metric
                label="Точка анализа"
                value={`${fmt(vertical.distanceKm, 1)} км, аз. ${fmt(vertical.azDeg, 0)}°`}
              />
              <Metric label="Рельеф в точке анализа" value={`${fmt(vertical.terrainM, 0)} м`} />
            </dl>
            {vertical.minHeightM === null && (
              <p className="text-xs text-destructive">
                На указанной дальности связь не обеспечивается ни на одной высоте до{" "}
                {fmt(vertMaxHM, 0)} м — увеличьте мощность, усиление антенн или
                поднимите антенну ПРД.
              </p>
            )}
          </div>
        ) : (
          <Placeholder text="График появится после устранения ошибок." />
        )}
      </CardContent>
    </Card>
  );
}
