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
