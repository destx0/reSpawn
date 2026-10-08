// Bundles the e2e fixture apps.
//   node test/checkpoints-e2e/build-fixtures.mjs
// The NgRx fixture needs Angular 17 + @ngrx/store(-devtools) + zone.js, which
// this repo doesn't depend on: point NG_NODE_MODULES at a node_modules that
// has them (e.g. the inspector-ng repo). Without it only the Redux fixture
// is built and run.mjs skips the NgRx checks.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const dir = import.meta.dirname;
const fixtures = path.join(dir, 'fixtures');

await esbuild.build({
  entryPoints: [path.join(fixtures, 'redux/main.js')],
  outfile: path.join(fixtures, 'redux/main.bundle.js'),
  bundle: true,
  format: 'iife',
  logLevel: 'warning',
  nodePaths: [path.join(dir, '../../node_modules')],
});
console.log('Built fixtures/redux');

const ngModules = process.env.NG_NODE_MODULES;
if (
  !ngModules ||
  !fs.existsSync(path.join(ngModules, '@ngrx/store-devtools'))
) {
  console.log('Skipped fixtures/ng (set NG_NODE_MODULES to build it)');
} else {
  await esbuild.build({
    entryPoints: [path.join(fixtures, 'ng/main.ts')],
    outfile: path.join(fixtures, 'ng/main.js'),
    bundle: true,
    format: 'iife',
    logLevel: 'warning',
    tsconfig: path.join(fixtures, 'ng/tsconfig.json'),
    nodePaths: [ngModules],
  });
  console.log('Built fixtures/ng');
}
