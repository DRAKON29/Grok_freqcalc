"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface NumberFieldProps {
  id: string;
  label: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  hint?: string;
  placeholder?: string;
  inputMode?: "decimal" | "numeric";
  className?: string;
}

/** Числовое поле с подписью параметра и единицей измерения. */
export function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  invalid,
  hint,
  placeholder,
  inputMode = "decimal",
  className,
}: NumberFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          className={cn(
            "pr-12 tabular-nums",
            invalid && "border-destructive focus-visible:ring-destructive"
          )}
        />
        {unit ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
      {hint ? (
        <p
          className={cn(
            "text-[11px] leading-snug",
            invalid ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
