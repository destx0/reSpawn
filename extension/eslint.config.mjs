import globals from 'globals';
import eslintJs from '../eslint.js.config.base.mjs';
import eslintTsReact from '../eslint.ts.react.config.base.mjs';
import eslintJsReactJest from '../eslint.js.react.jest.config.base.mjs';

export default [
  ...eslintJs,
  ...eslintTsReact(import.meta.dirname),
  ...eslintJsReactJest,
  {
    ignores: [
      'chrome',
      'dist',
      'edge',
      'examples',
      'firefox',
      'jest.config.ts',
      'test/electron/fixture/dist',
      'test/checkpoints-e2e/fixtures',
    ],
  },
  {
    files: ['build.mjs'],
    languageOptions: {
      globals: {
        ...globals.nodeBuiltin,
      },
    },
  },
  {
    files: ['test/checkpoints-e2e/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        WebSocket: 'readonly',
      },
    },
  },
  {
    files: ['test/**/*.js', 'test/**/*.jsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        EUI: true,
      },
    },
  },
];
