"use client";

// Панель рельефа: загрузка HGT, синтетический режим, список тайлов, кэш (Фаза 1, 1.1).

import { Download, HardDrive, Mountain, Trash2, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useRef } from "react";

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
import { useCalculatorStore, useDerived } from "@/lib/radio/calculator-store";

export function TerrainPanel() {
  const d = useDerived();
  const fileRef = useRef<HTMLInputElement>(null);

  const tiles = useCalculatorStore((s) => s.tiles);
  const tileErrors = useCalculatorStore((s) => s.tileErrors);
  const reading = useCalculatorStore((s) => s.reading);
  const useSynthetic = useCalculatorStore((s) => s.useSynthetic);
  // Фаза 3.1: автозагрузка DEM через /api/dem
  const autoDem = useCalculatorStore((s) => s.autoDem);
  const demBusy = useCalculatorStore((s) => s.demBusy);
  const demError = useCalculatorStore((s) => s.demError);
  const setAutoDem = useCalculatorStore((s) => s.setAutoDem);
  const ensureRequiredTiles = useCalculatorStore((s) => s.ensureRequiredTiles);
  const cacheLoading = useCalculatorStore((s) => s.cacheLoading);
  const cacheCount = useCalculatorStore((s) => s.cacheCount);
  const restoreCachedTiles = useCalculatorStore((s) => s.restoreCachedTiles);
  const addTileFiles = useCalculatorStore((s) => s.addTileFiles);
  const removeCachedTiles = useCalculatorStore((s) => s.removeCachedTiles);
  const setUseSynthetic = useCalculatorStore((s) => s.setUseSynthetic);

  // Восстановление тайлов из IndexedDB при монтировании (был useEffect в родителе).
  useEffect(() => {
    void restoreCachedTiles();
  }, [restoreCachedTiles]);

  // --- строки списка тайлов ---
  const tileRows: Array<{ name: string; role: string; present: boolean; info?: string }> = [];
  for (const name of d.required.path) {
    tileRows.push({ name, role: "трасса", present: tiles.has(name) });
  }
  for (const name of d.required.area) {
    tileRows.push({ name, role: "зона", present: tiles.has(name) });
  }
  const reqSet = new Set([...d.required.path, ...d.required.area]);
  for (const [name, t] of tiles) {
    if (!reqSet.has(name)) {
      tileRows.push({ name, role: "вне области", present: true, info: `${t.arcSec}″` });
    }
  }
  const missingCount = tileRows.filter((r) => !r.present).length;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mountain className="h-4 w-4 text-muted-foreground" />
          Рельеф (файлы HGT)
        </CardTitle>
        <CardDescription>
          SRTM 3″ или 1″; имя тайла — юго-западный угол, например N55E037.hgt
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".hgt"
          multiple
          className="hidden"
          onChange={(e) => {
            void addTileFiles(e.target.files);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        <Button
          variant="outline"
          className="w-full"
          disabled={reading}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          {reading ? "Чтение файлов…" : "Загрузить файлы .hgt"}
        </Button>

        <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={useSynthetic}
            onChange={(e) => setUseSynthetic(e.target.checked)}
          />
          <span>
            <span className="font-medium">Синтетический рельеф</span>
            <span className="block text-xs text-muted-foreground">
              Демо-режим без HGT (из Grok_freqcalc). Не для ответственных расчётов.
            </span>
          </span>
        </label>

        {/* --- Фаза 3.1: автозагрузка реального DEM (Copernicus GLO-30) --- */}
        <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={autoDem}
            disabled={useSynthetic}
            onChange={(e) => setAutoDem(e.target.checked)}
          />
          <span>
            <span className="font-medium">Автозагрузка рельефа (GLO-30)</span>
            <span className="block text-xs text-muted-foreground">
              Недостающие тайлы скачиваются автоматически через /api/dem и
              кэшируются в браузере. {demBusy ? "Загрузка…" : ""}
            </span>
          </span>
        </label>

        {!useSynthetic && autoDem && missingCount > 0 && !demBusy && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => void ensureRequiredTiles()}
          >
            <Download className="h-4 w-4" />
            докачать недостающие тайлы ({missingCount})
          </Button>
        )}

        {demError && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>Автозагрузка DEM</AlertTitle>
            <AlertDescription>{demError}</AlertDescription>
          </Alert>
        )}

        {tileErrors.length > 0 && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>Файлы не приняты</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-0.5 pl-4">
                {tileErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {tileRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Загрузите тайлы, покрывающие трассу и зону анализа — список появится здесь.
          </p>
        ) : (
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {tileRows.map((r) => (
              <div
                key={r.name}
                className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs"
              >
                <span className="font-mono font-medium">{r.name}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{r.info ?? r.role}</span>
                  {r.present ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      есть
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                      нет
                    </Badge>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        {tileRows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {missingCount === 0
              ? `Все нужные тайлы загружены (${tileRows.length} шт.).`
              : `Не хватает файлов: ${missingCount}.`}
          </p>
        )}

        {/* --- Кэш тайлов в IndexedDB --- */}
        <div className="rounded-lg border bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">Кэш браузера</span>
              {cacheLoading ? (
                <span className="text-muted-foreground">чтение…</span>
              ) : (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {cacheCount > 0
                    ? `${cacheCount} ${cacheCount === 1 ? "тайл" : cacheCount < 5 ? "тайла" : "тайлов"}`
                    : "пусто"}
                </Badge>
              )}
            </div>
            {cacheCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => void removeCachedTiles()}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Очистить
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Загруженные тайлы сохраняются в браузере (IndexedDB) и восстанавливаются
            автоматически при перезагрузке страницы.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
