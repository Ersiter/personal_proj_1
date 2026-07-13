import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { exportCadSnapshot } from './export-cad-snapshot.mjs';
import { prepareCadDrawing } from './prepare-cad-drawing.mjs';

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
  const directory = await mkdtemp(join(tmpdir(), 'dai-qidong-cad-build-'));
  try {
    const preparedDrawing = join(directory, 'field-materialized.dwg');
    await prepareCadDrawing({ inputPath: drawing, outputPath: preparedDrawing });
    await exportCadSnapshot({ inputPath: preparedDrawing, outputPath: output('floorplan.mlcad') });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  console.log('No local DWG found; snapshot generation skipped.');
}

console.log(`CAD assets written to ${outputDirectory}`);
