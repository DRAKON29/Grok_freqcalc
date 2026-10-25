import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**/*",
      ".bun/**/*",
      ".next/**/*",
      "out/**/*",
      "dist/**/*",
      "build/**/*",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" },
      ],
    },
  },
  {
    // Чистое расчётное ядро не должно зависеть от UI (предпосылка для worker/API — Фазы 2/4).
    files: ["src/lib/radio/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components/**", "@/components/*", "../components/**", "../../components/**"],
              message: "Ядро src/lib/radio не может импортировать UI-компоненты (см. PLAN.md, задача 1.4).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
