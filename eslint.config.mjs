// @ts-check
/**
 * One flat config for both halves of the repo.
 *
 * Why one file at the root rather than one per package: the two projects are
 * type-checked by their own tsconfig (see `npm run lint` siblings `tsc
 * --noEmit`), so this config deliberately does NOT use the type-aware rules —
 * they would need two project services and would re-check what tsc already
 * proves with `strict: true`. What is left is the layer tsc cannot see: dead
 * variables, accidental globals, empty blocks, unreachable code, and the
 * `no-undef` holes that only bite plain-JS scripts.
 *
 * `eslint .` from the root lints everything that matters:
 *   src/                     the server
 *   client/src/              the app
 *   client/scripts/          browser tooling (.mjs)
 *
 * and ignores build output, so dist/ never contributes findings.
 */

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "docs/**",
      ".freebuff/**",
      "**/*.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    /**
     * Playwright tooling runs in Node but its `page.evaluate` callbacks are
     * parsed as plain functions and execute in the browser — both global sets
     * are genuinely reachable code, not a blanket exemption.
     */
    files: ["client/scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    /**
     * `_`-prefixed names are a deliberate "unused on purpose" signal in this
     * codebase (interface stubs, required-but-ignored parameters), and a
     * caught error left unnamed as bare `catch {}` is a deliberate swallow.
     * Both are choices, so they are not errors; anything else is.
     */
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
);
