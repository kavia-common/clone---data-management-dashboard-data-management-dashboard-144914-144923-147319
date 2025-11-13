module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/__tests__/**/*.test.jsx'],
  transform: {},
  verbose: false,
  testTimeout: 30000,
  // Ignore frontend workspace if monorepo tests are invoked from root
  modulePathIgnorePatterns: ['<rootDir>/../mongodb_dashboard_frontend/'],
};
