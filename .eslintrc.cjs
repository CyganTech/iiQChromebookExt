module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    webextensions: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:no-unsanitized/recommended-legacy',
    'plugin:prettier/recommended'
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint', 'no-unsanitized', 'prettier'],
  settings: {},
  ignorePatterns: ['extension/dist', 'node_modules'],
  rules: {
    'prettier/prettier': 'error'
  },
  overrides: [
    {
      files: ['*.js'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off'
      }
    }
  ],
  globals: {
    chrome: 'readonly'
  }
};
