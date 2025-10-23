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
  // Ignore node_modules and any nested frontend workspace copies to avoid ESM parsing errors
  ignores: [
    'node_modules/**',
    'data-management-dashboard-144914-144924/**',
    '**/mongodb_dashboard_frontend/**',
  ],
};

module.exports = [ignoreConfig, jsConfig];