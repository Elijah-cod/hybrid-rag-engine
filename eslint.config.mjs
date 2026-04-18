import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "supabase/functions/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      "no-console": "warn"
    }
  }
);
