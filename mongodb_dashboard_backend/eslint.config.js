import globals from "globals";

export default [
  {
    name: "root-node-backend",
    files: ["**/*.js"],
    ignores: [
      "node_modules/**",
      "coverage/**",
      "dist/**",
      "build/**",
      ".tmp/**",
      "**/*.test.js",
      "jest.config.js",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2021,
        // Express request/response convenience in JSDoc comments etc.
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // General code quality
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_+" }],
      "no-undef": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-console": "off",

      // Node/CommonJS preferences in backend
      "strict": ["error", "global"],

      // Stylistic
      "quotes": ["error", "single", { avoidEscape: true }],
      "semi": ["error", "always"],
      "comma-dangle": ["error", "always-multiline"],
      "object-curly-spacing": ["error", "always"],
      "array-bracket-spacing": ["error", "never"],
      "space-before-function-paren": ["error", { anonymous: "never", named: "never", asyncArrow: "always" }],

      // Best practices
      "eqeqeq": ["error", "smart"],
      "curly": ["error", "multi-line", "consistent"],
    },
  },
];
