"use client";

// Панель параметров радиолинии (Фаза 1, задача 1.1): частота, мощность,
// усиления/фидеры, высоты антенн, k, поляризация. Состояние — в сторе.

import { RadioTower } from "lucide-react";
import { useState } from "react";

import { NumberField } from "@/components/radio/number-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RADIO_FIELDS } from "@/lib/radio/form";
import type { FreqMode, Polarization, PowerUnit } from "@/lib/radio/form";
import { useCalculatorStore, useDerived } from "@/lib/radio/calculator-store";
import { cn } from "@/lib/utils";

const FIELDS_NO_F = RADIO_FIELDS.filter((f) => f.key !== "fMHz");

export function SettingsPanel() {
  const d = useDerived();
  const values = useCalculatorStore((s) => s.values);
  const setField = useCalculatorStore((s) => s.setField);
  const freqMode = useCalculatorStore((s) => s.freqMode);
  const switchFreqMode = useCalculatorStore((s) => s.switchFreqMode);
  const powerUnit = useCalculatorStore((s) => s.powerUnit);
  const switchPowerUnit = useCalculatorStore((s) => s.switchPowerUnit);
  const polarization = useCalculatorStore((s) => s.polarization);
  const setPolarization = useCalculatorStore((s) => s.setPolarization);
  const resetAll = useCalculatorStore((s) => s.resetAll);
  // Контролируемое раскрытие Select: без него Radix перечитывает значение
  // при каждом наборе символа и закрывает выпадающий список (regression-фикс).
  const [polarOpen, setPolarOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <RadioTower className="h-4 w-4 text-muted-foreground" />
          Параметры радиолинии
        </CardTitle>
        <CardDescription>Модель потерь ITU-R P.525 / P.526</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-x-3 gap-y-4">
        {/* Режим частоты */}
        <div className="col-span-2">
          <Tabs value={freqMode} onValueChange={(v) => switchFreqMode(v as FreqMode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="single">Одна частота</TabsTrigger>
              <TabsTrigger value="range">Диапазон ПРД/ПРМ</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Поля частоты */}
        {freqMode === "single" ? (
          <NumberField
            id="fMHz"
            label="Частота"
            unit="МГц"
            value={values.fMHz}
            onChange={(v) => setField("fMHz", v)}
            invalid={d.parsed.bad.has("fMHz")}
            hint="от 50 до 7000"
          />
        ) : (
          <>
            <div className="col-span-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Диапазон частот ПРД
            </div>
            <NumberField
              id="txFMinMHz"
              label="Частота ПРД мин."
              unit="МГц"
              value={values.txFMinMHz ?? ""}
              onChange={(v) => setField("txFMinMHz", v)}
              invalid={d.parsed.bad.has("txFMinMHz")}
              hint="от 50"
            />
            <NumberField
              id="txFMaxMHz"
              label="Частота ПРД макс."
              unit="МГц"
              value={values.txFMaxMHz ?? ""}
              onChange={(v) => setField("txFMaxMHz", v)}
              invalid={d.parsed.bad.has("txFMaxMHz")}
              hint="до 7000, ≥ мин."
            />
            <div className="col-span-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Диапазон частот ПРМ
            </div>
            <NumberField
              id="rxFMinMHz"
              label="Частота ПРМ мин."
              unit="МГц"
              value={values.rxFMinMHz ?? ""}
              onChange={(v) => setField("rxFMinMHz", v)}
              invalid={d.parsed.bad.has("rxFMinMHz")}
              hint="от 50"
            />
            <NumberField
              id="rxFMaxMHz"
              label="Частота ПРМ макс."
              unit="МГц"
              value={values.rxFMaxMHz ?? ""}
              onChange={(v) => setField("rxFMaxMHz", v)}
              invalid={d.parsed.bad.has("rxFMaxMHz")}
              hint="до 7000, ≥ мин."
            />
          </>
        )}

        {/* Мощность ПРД с переключателем единиц */}
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="pTxDbm" className="text-[13px]">
            Мощность ПРД
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="pTxDbm"
                value={values.pTxDbm}
                onChange={(e) => setField("pTxDbm", e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={d.parsed.bad.has("pTxDbm") || undefined}
                className={cn(
                  "pr-12 tabular-nums",
                  d.parsed.bad.has("pTxDbm") &&
                    "border-destructive focus-visible:ring-destructive"
                )}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                {powerUnit === "dBm" ? "дБм" : "мВт"}
              </span>
            </div>
            <Tabs value={powerUnit} onValueChange={(v) => switchPowerUnit(v as PowerUnit)}>
              <TabsList className="h-9">
                <TabsTrigger value="dBm">дБм</TabsTrigger>
                <TabsTrigger value="mW">мВт</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {d.parsed.bad.has("pTxDbm") && (
            <p className="text-[11px] text-destructive">
              {powerUnit === "dBm" ? "от −30 до 60" : "от 0,001 до 1 000 000"}
            </p>
          )}
        </div>

        {/* Остальные параметры (без fMHz) */}
        {FIELDS_NO_F.map((f) => (
          <NumberField
            key={f.key}
            id={f.key}
            label={f.label}
            unit={f.unit}
            value={values[f.key] ?? ""}
            onChange={(v) => setField(f.key, v)}
            invalid={d.parsed.bad.has(f.key)}
            hint={f.hint}
            className={
              f.key === "txAntHM" || f.key === "rxAntHM" || f.key === "kFactor"
                ? "col-span-2"
                : undefined
            }
          />
        ))}

        {/* Ширина луча (опционально) */}
        <NumberField
          id="beamWidthDeg"
          label="Ширина луча (опц.)"
          unit="°"
          value={values.beamWidthDeg ?? ""}
          onChange={(v) => setField("beamWidthDeg", v)}
          invalid={d.parsed.bad.has("beamWidthDeg")}
          hint="0 — ненаправленная"
        />

        {/* Поляризация */}
        <div className="space-y-1.5">
          <Label className="text-[13px]">Поляризация</Label>
          <Select
            value={polarization}
            onValueChange={(v) => {
              setPolarization(v as Polarization);
              setPolarOpen(false);
            }}
            open={polarOpen}
            onOpenChange={setPolarOpen}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="V">Вертикальная</SelectItem>
              <SelectItem value="H">Горизонтальная</SelectItem>
              <SelectItem value="C">Круговая</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" size="sm" onClick={resetAll} className="col-span-2 mt-1">
          Сбросить значения
        </Button>
      </CardContent>
    </Card>
  );
}
