/// PUBLIC_INTERFACE
/** ESLint flat config for backend (Node/Express)
 * - Targets only the backend src and root JS files
 * - Ignores node_modules, dist/build, coverage, and any frontend/workspace folders
 * - Uses recommended rules and globals for Node and Jest
 * - Prevents false positives for unused vars via _-prefix convention
 */
import globals from "globals";

export default [
  {
    name: "backend-base",
    files: ["**/*.js"],
    ignores: [
      // General ignores
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      // Editor/OS
      ".git/**",
      ".tmp/**",
      // Explicitly ignore any sibling frontend workspace to avoid cross-container lint bleed
      "../mongodb_dashboard_frontend/**",
      "../../mongodb_dashboard_frontend/**",
      // Ignore attachments/assets outside code
      "../../attachments/**",
      "../../assets/**",
      // Ignore test snapshots or fixtures if any
      "**/__snapshots__/**",
      "**/fixtures/**"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2021,
        ...globals.jest
      }
    },
    rules: {
      // Core quality rules
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "error",
      "eqeqeq": ["warn", "smart"],
      "curly": ["warn", "all"],
      "no-empty": ["warn", { "allowEmptyCatch": true }],

      // Node/Express style adjustments
      "callback-return": "off",
      "handle-callback-err": "off",
      "no-mixed-requires": "off",

      // Import/export in CommonJS
      "import/no-commonjs": "off",
      "import/no-unresolved": "off"
    }
  },
  // Target only backend source code for stricter settings if needed
  {
    name: "backend-src",
    files: ["src/**/*.js"],
    rules: {
      // Stricter unused rule in src
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  }
];
