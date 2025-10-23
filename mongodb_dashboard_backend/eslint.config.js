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
  ignores: ['node_modules/**'],
};

module.exports = [ignoreConfig, jsConfig];