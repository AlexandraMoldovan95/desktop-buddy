'use strict';
// ESLint flat config: @eslint/js recommended, the right globals per folder.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['site/', 'dist/', 'build/', 'node_modules/', '_demo-data/', '_archive/', 'recordings/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs' },
    // `const { secret, ...rest } = obj` is how we drop fields (paths, passwords) before sending data on
    rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
  // main process, preload scripts, build scripts and tests run in Node
  {
    files: ['src/main/**/*.js', 'src/preload/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  // pages: classic browser scripts
  {
    files: ['src/renderer/**/*.js', 'web/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  // UMD files: loaded by Node (require, in tests) and by pages (<script>)
  {
    files: ['src/shared/**/*.js', 'src/renderer/shared/text-diff.js', 'src/renderer/recorder/idle.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
