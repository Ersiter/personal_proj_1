import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { exportCadSnapshot } from './export-cad-snapshot.mjs';

const root = resolve(import.meta.dirname, '..');
const outputDirectory = resolve(root, 'assets', 'cad');
const source = (...parts) => resolve(root, 'node_modules', ...parts);
const output = (...parts) => resolve(outputDirectory, ...parts);

await mkdir(outputDirectory, { recursive: true });
const sharedBuildOptions = {
  bundle: true,
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'none',
  plugins: [{
    name: 'three-example-extension-compat',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^three\/examples\/jsm\// }, (args) => {
        if (args.path.endsWith('.js')) return undefined;
        return { path: source(`${args.path}.js`) };
      });
      buildContext.onResolve({ filter: /^mlightcad-snapshot-codec$/ }, () => {
        return { path: source('@mlightcad', 'cad-html-plugin', 'lib', 'AcExSnapshotBinaryCodec.js') };
      });
    }
  }]
};

await build({
  entryPoints: [resolve(root, 'src', 'cad-viewer.js')],
  outfile: output('cad-viewer.js'),
  format: 'esm',
  ...sharedBuildOptions
});

await Promise.all([
  cp(source('@mlightcad', 'cad-html-plugin', 'LICENSE'), output('MLIGHTCAD-CAD-HTML-PLUGIN-MIT.txt')),
  cp(source('three', 'LICENSE'), output('THREE-MIT.txt'))
]);

const drawing = output('装修图纸.dwg');
if (existsSync(drawing)) {
  await exportCadSnapshot({ inputPath: drawing, outputPath: output('floorplan.mlcad') });
} else {
  console.log('No local DWG found; snapshot generation skipped.');
}

console.log(`CAD assets written to ${outputDirectory}`);
