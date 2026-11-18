import nkzw from '@nkzw/oxlint-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [nkzw],
  env: { browser: false, node: true },
  overrides: [
    {
      files: ['apps/client/**/*.js', 'scripts/page-spy.js'],
      env: { browser: true, node: false },
    },
  ],
  rules: {
    'perfectionist/sort-objects': 'off',
    'eslint/curly': 'off',
    // CLI output, local closures and existing spelling are intentional style.
    'eslint/no-console': 'off',
    'unicorn/numeric-separators-style': 'off',
    'unicorn/consistent-function-scoping': 'off',
    'unicorn/prefer-string-replace-all': 'off',
    'unicorn/catch-error-name': 'off',
    // Pi documents are live proxies, which structuredClone cannot copy.
    'unicorn/prefer-structured-clone': 'off',
    // Error classes carry useful protocol details.
    '@nkzw/no-instanceof': 'off',
    'eslint/no-empty': ['error', { allowEmptyCatch: true }],
  },
});
