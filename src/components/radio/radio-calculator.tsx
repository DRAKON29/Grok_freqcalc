"use client";

// Композиция калькулятора (Фаза 1, задача 1.1): монолитный
// radio-calculator.tsx разбит на панели; состояние — в zustand-сторе
// (@/lib/radio/calculator-store). Поведение и формулы сохранены 1-в-1.

import { CoordinatesPanel } from "@/components/radio/coordinates-panel";
import { CoveragePanel } from "@/components/radio/coverage-panel";
import { ResultsPanel } from "@/components/radio/results-panel";
import { SettingsPanel } from "@/components/radio/settings-panel";
import { TerrainPanel } from "@/components/radio/terrain-panel";
import { TrajectoryPanel } from "@/components/radio/trajectory-panel";
import { VerticalPanel } from "@/components/radio/vertical-panel";
import { useDemAuto, useLinkAsync } from "@/lib/radio/calculator-store";

export function RadioCalculator() {
  // Фаза 2.1 / 3.1: корневые подписки — асинхронный расчёт трассы (worker)
  // и автозагрузка тайлов DEM под видимую область карты.
  useLinkAsync();
  useDemAuto();
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      {/* ===================== Левая колонка: ввод ===================== */}
      <div className="space-y-6">
        <SettingsPanel />
        <CoordinatesPanel />
        <TerrainPanel />
      </div>

      {/* ===================== Правая колонка: результаты ===================== */}
      <div className="space-y-6">
        <CoveragePanel />
        <ResultsPanel />
        <TrajectoryPanel />
        <VerticalPanel />
      </div>
    </div>
  );
}
