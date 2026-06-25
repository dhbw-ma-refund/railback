// RailBack backend ESLint config.
//
// ARCHITECTURE.md describes a "no-restricted-imports rule in the base
// tsconfig" forbidding direct @aws-sdk/client-dynamodb and
// @aws-sdk/client-s3 imports outside lib/src/storage/ddb and lib/src/storage/s3.
// no-restricted-imports is an ESLint rule, not a tsconfig setting, so the
// enforcement actually lives here.
//
// All paths are relative to the eslint working dir (= backend/).

/** @type {import('eslint').Linter.Config} */
const RESTRICTED_IMPORTS = ['error', {
  paths: [
    {
      name: '@aws-sdk/client-dynamodb',
      message: 'Go through @railback/lib/storage/ddb/* repos.',
    },
    {
      name: '@aws-sdk/lib-dynamodb',
      message: 'Go through @railback/lib/storage/ddb/* repos.',
    },
    {
      name: '@aws-sdk/client-s3',
      message: 'Go through @railback/lib/storage/s3/* helpers.',
    },
    {
      name: '@aws-sdk/s3-request-presigner',
      message: 'Go through @railback/lib/storage/s3/* helpers.',
    },
    {
      name: '@aws-sdk/s3-presigned-post',
      message: 'Go through @railback/lib/storage/s3/* helpers.',
    },
  ],
}];

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {},
  overrides: [
    {
      // Lambdas, mocks, tests: never import AWS SDK directly.
      files: ['lambdas/**/*.ts', 'mocks/**/*.ts', 'tests/**/*.ts'],
      rules: { 'no-restricted-imports': RESTRICTED_IMPORTS },
    },
    {
      // lib code: same rule, but the storage/ddb and storage/s3 adapter
      // dirs ARE allowed to import the SDK — that is their whole job.
      files: ['lib/src/**/*.ts'],
      excludedFiles: ['lib/src/storage/ddb/**', 'lib/src/storage/s3/**'],
      rules: { 'no-restricted-imports': RESTRICTED_IMPORTS },
    },
  ],
};
