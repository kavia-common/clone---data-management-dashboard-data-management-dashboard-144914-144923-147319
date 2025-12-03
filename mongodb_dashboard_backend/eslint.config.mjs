import globals from "globals";

/**
 * ESLint v9 flat config for Node/Express backend.
 * - Replaces legacy .eslintrc.json
 * - Targets Node (CommonJS) with ES2022
 * - Keep warnings non-fatal in CI by design (lint script should not fail build on warnings)
 */
export default [
  {
    name: "root",
    files: ["src/**/*.js", "swagger.js"],
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "*.config.js",
      ".tmp/**"
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.node,
        ...globals.es2022,
        ...globals.jest
      },
    },
    linterOptions: {
      // Do not treat warnings as errors; CI should not fail on warnings
      // If a CI environment treats warnings as errors, ensure scripts use `eslint . || true`
      // or keep this configuration file to warnings-only for ergonomics.
      reportUnusedDisableDirectives: false,
    },
    rules: {
      // Keep core safety checks strict
      "no-undef": "error",
      "eqeqeq": ["error", "always"],
      "curly": ["error", "all"],
      "no-var": "error",

      // Developer ergonomics - warnings only
      "no-console": "off",
      "prefer-const": "warn",
      "object-shorthand": ["warn", "always"],
      // Backend only: no React hooks rules here; unused vars only warn and allow prefixed underscores
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
