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
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],

      // Not a React project in this container; ensure no react rules interfere even if auto-detected
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
