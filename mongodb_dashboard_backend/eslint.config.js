/** @type {import("eslint").FlatConfig[]} */
const jsConfig = {
  files: ['**/*.js'],
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'commonjs',
    globals: {
      process: 'readonly',
      module: 'readonly',
      __dirname: 'readonly',
      require: 'readonly',
      console: 'readonly',
    },
  },
  rules: {
    semi: ['error', 'always'],
    quotes: ['error', 'single'],
  },
};

const ignoreConfig = {
  // Ignore vendored frontend code nested under backend workspace (ESM modules trigger parsing errors)
  ignores: ['node_modules/**', 'data-management-dashboard-144914-144924/**'],
};

module.exports = [ignoreConfig, jsConfig];