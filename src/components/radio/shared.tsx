"use client";

// Общие мелкие примитивы панелей калькулятора (Фаза 1, задача 1.1).

import { cn } from "@/lib/utils";

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export function Placeholder({ text, warning }: { text: string; warning?: boolean }) {
  return (
    <div className="flex min-h-52 items-center justify-center rounded-lg border border-dashed p-6 text-center">
      <p
        className={cn(
          "max-w-sm text-sm",
          warning ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {text}
      </p>
    </div>
  );
}
