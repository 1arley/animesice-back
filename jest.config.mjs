export default {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  setupFiles: ['<rootDir>/../test/setup-env.js'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!sanitize-html|htmlparser2|domhandler|domutils|entities|domelementtype|dom-serializer)',
  ],
  collectCoverageFrom: [
    '**/*.(t|j)s',
    // Boilerplate declarativo (modules, entrypoints, DTOs, swagger) não faz
    // sentido medir: são anotações estáticas sem lógica executável.
    '!**/*.spec.ts',
    '!**/*.e2e-spec.ts',
    '!**/*.module.ts',
    '!**/dto/**',
    '!**/swagger/**',
    '!**/main.ts',
    '!**/index.ts',
    // Automação de browser (Playwright/Chromium) é coberta por testes de
    // integração com mocks + e2e, não por unit tests: exige browser real,
    // timers e eventos de página. Medir aqui derruba o gate global sem
    // refletir a qualidade da lógica de negócio.
    '!**/browser-pool.service.ts',
    '!**/event-waits.ts',
  ],
  coverageDirectory: '../coverage',
  coverageReporters: ['text-summary', 'json-summary', 'lcov', 'html'],
  // Portão de cobertura: qualquer regressão abaixo destes números falha o CI.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 80,
      functions: 90,
      lines: 90,
    },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^~/(.*)$': '<rootDir>/$1',
    '^@components/(.*)$': '<rootDir>/components/$1',
    '^@utils/(.*)$': '<rootDir>/utils/$1',
    '^@test/(.*)$': '<rootDir>/../test/$1',
  },
};
