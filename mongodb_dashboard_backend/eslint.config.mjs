import globals from "globals";

/**
 * ESLint v9 flat config for Node/Express backend.
 * - Replaces legacy .eslintrc.json
 * - Targets Node (CommonJS) with ES2022
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
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-console": "off",
      "eqeqeq": ["error", "always"],
      "curly": ["error", "all"],
      "prefer-const": "warn",
      "no-var": "error",
      "object-shorthand": ["warn", "always"],
    },
  },
];
