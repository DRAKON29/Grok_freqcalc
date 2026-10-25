"use client";

// Панель координат СК-42 и карты выбора точек (Фаза 1, задача 1.1).

import { Map as LucideMap } from "lucide-react";

import { NumberField } from "@/components/radio/number-field";
import { MapPicker } from "@/components/radio/map-picker";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CoordMode } from "@/lib/radio/form";
import { fmt, fmtDms } from "@/lib/radio/format";
import { useCalculatorStore, useDerived } from "@/lib/radio/calculator-store";

export function CoordinatesPanel() {
  const d = useDerived();
  const values = useCalculatorStore((s) => s.values);
  const setField = useCalculatorStore((s) => s.setField);
  const coordMode = useCalculatorStore((s) => s.coordMode);
  const setCoordMode = useCalculatorStore((s) => s.setCoordMode);
  const pickMode = useCalculatorStore((s) => s.pickMode);
  const togglePickMode = useCalculatorStore((s) => s.togglePickMode);
  const handleMapPick = useCalculatorStore((s) => s.handleMapPick);
  const trajectoryResult = useCalculatorStore((s) => s.trajectoryResult);
  const trajectory = useCalculatorStore((s) => s.trajectory);

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Координаты, СК-42</CardTitle>
          <CardDescription>
            Эллипсоид Красовского; переход в WGS-84 по ГОСТ Р 51794-2008. Обе
            точки — приёмопередатчики (полный дуплексный обмен). Станция B
            опциональна — без неё строится только зона связи вокруг A.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={coordMode} onValueChange={(v) => setCoordMode(v as CoordMode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="deg">Градусы B, L</TabsTrigger>
              <TabsTrigger value="gk">Метры X, Y (ГК)</TabsTrigger>
            </TabsList>
          </Tabs>

          {coordMode === "deg" ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-4">
              <NumberField
                id="txB"
                label="Станция A: широта B"
                unit="°"
                value={values.txB}
                onChange={(v) => setField("txB", v)}
                invalid={d.points.bad.has("txB")}
                hint="−90…90"
              />
              <NumberField
                id="txL"
                label="Станция A: долгота L"
                unit="°"
                value={values.txL}
                onChange={(v) => setField("txL", v)}
                invalid={d.points.bad.has("txL")}
                hint="−180…180"
              />
              <NumberField
                id="rxB"
                label="Станция B: широта B (опц.)"
                unit="°"
                value={values.rxB}
                onChange={(v) => setField("rxB", v)}
                invalid={d.points.bad.has("rxB")}
                hint="−90…90"
              />
              <NumberField
                id="rxL"
                label="Станция B: долгота L (опц.)"
                unit="°"
                value={values.rxL}
                onChange={(v) => setField("rxL", v)}
                invalid={d.points.bad.has("rxL")}
                hint="−180…180"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-4">
              <NumberField
                id="txX"
                label="ПРД: X (от экватора)"
                unit="м"
                value={values.txX}
                onChange={(v) => setField("txX", v)}
                invalid={d.points.bad.has("txX")}
              />
              <NumberField
                id="txY"
                label="ПРД: Y (X + зона·10⁶)"
                unit="м"
                value={values.txY}
                onChange={(v) => setField("txY", v)}
                invalid={d.points.bad.has("txY")}
              />
              <NumberField
                id="rxX"
                label="ПРМ: X (опц.)"
                unit="м"
                value={values.rxX}
                onChange={(v) => setField("rxX", v)}
                invalid={d.points.bad.has("rxX")}
              />
              <NumberField
                id="rxY"
                label="ПРМ: Y (опц.)"
                unit="м"
                value={values.rxY}
                onChange={(v) => setField("rxY", v)}
                invalid={d.points.bad.has("rxY")}
              />
            </div>
          )}

          {d.txWgs && (
            <dl className="space-y-1 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">ПРД, WGS-84</dt>
                <dd className="tabular-nums">
                  {fmtDms(d.txWgs.lat, "lat")} {fmtDms(d.txWgs.lon, "lon")}
                </dd>
              </div>
              {d.rxWgs && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">ПРМ, WGS-84</dt>
                  <dd className="tabular-nums">
                    {fmtDms(d.rxWgs.lat, "lat")} {fmtDms(d.rxWgs.lon, "lon")}
                  </dd>
                </div>
              )}
              {d.points.txGk && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">ПРД, Гаусс–Крюгер</dt>
                  <dd className="tabular-nums">
                    X {fmt(d.points.txGk.x, 0)}, Y {fmt(d.points.txGk.y, 0)}
                  </dd>
                </div>
              )}
              {d.points.rxGk && d.rxOk && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">ПРМ, Гаусс–Крюгер</dt>
                  <dd className="tabular-nums">
                    X {fmt(d.points.rxGk.x, 0)}, Y {fmt(d.points.rxGk.y, 0)}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </CardContent>
      </Card>

      {/* --- Карта выбора точек --- */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <LucideMap className="h-4 w-4 text-muted-foreground" />
            Карта
          </CardTitle>
          <CardDescription>
            Кликните на карте, чтобы задать точку ПРД или ПРМ. Координаты
            пересчитываются в СК-42 автоматически. Слои: Google Схема /
            Спутник / Гибрид.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MapPicker
            tx={d.txWgs}
            rx={d.rxWgs}
            trajectory={
              trajectoryResult
                ? trajectoryResult.points.map((p) => ({
                    lat: p.lat,
                    lon: p.lon,
                    status: p.status,
                  }))
                : trajectory
                  ? trajectory.points.map((p) => ({
                      lat: p.lat,
                      lon: p.lon,
                      status: null,
                    }))
                  : undefined
            }
            pickMode={pickMode}
            onPick={handleMapPick}
            onChangePickMode={togglePickMode}
          />
        </CardContent>
      </Card>
    </>
  );
}
