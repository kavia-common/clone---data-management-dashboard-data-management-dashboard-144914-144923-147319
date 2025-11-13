 /* eslint-disable n/no-unsupported-features/es-syntax */
 /**
  * ESLint Flat Config for Node.js (CommonJS) backend.
  * - Targets Node 18+ environment.
  * - Keeps rules minimal, focused on catching unused variables/imports and common errors.
  * - Frontend-specific React/ARIA rules are not applied to this backend container.
  */
 const globals = require("globals");

 module.exports = [
   {
     files: ["**/*.js"],
     ignores: [
       "node_modules/**",
       "coverage/**",
       "dist/**",
       "build/**",
       ".tmp/**"
     ],
     languageOptions: {
       ecmaVersion: 2022,
       sourceType: "script",
       globals: {
         ...globals.node,
         ...globals.es2022,
         // Jest test env globals
         describe: "readonly",
         it: "readonly",
         test: "readonly",
         expect: "readonly",
         beforeAll: "readonly",
         beforeEach: "readonly",
         afterAll: "readonly",
         afterEach: "readonly",
         jest: "readonly",
       },
     },
     rules: {
       // Possible problems
       "no-undef": "error",
       "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
       "no-console": ["warn", { allow: ["warn", "error", "info", "log"] }],
       "no-constant-condition": ["error", { checkLoops: false }],
       "no-dupe-keys": "error",
       "no-duplicate-imports": "error",

       // Best practices
       eqeqeq: ["error", "smart"],
       "no-var": "error",
       "prefer-const": ["warn", { destructuring: "all" }],
       "prefer-template": "warn",
       "object-shorthand": ["warn", "always"],
       "arrow-body-style": ["warn", "as-needed"],
       "no-useless-concat": "warn",
       "no-useless-return": "warn",
     },
   },
 ];
