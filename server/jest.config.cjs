module.exports = {
  preset: 'ts-jest', testEnvironment: 'node', testMatch: ['**/test/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  coverageThreshold: { global: { lines: 80 } },
  coverageReporters: ['text', 'lcov', 'json-summary']
};
