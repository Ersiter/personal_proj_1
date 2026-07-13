import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { exportCadSnapshot } from './export-cad-snapshot.mjs';
import { prepareCad2004 } from './prepare-cad-2004.mjs';

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
    const downgradedDrawing = join(directory, 'floorplan-2004.dwg');
    await prepareCad2004({ inputPath: drawing, outputPath: downgradedDrawing });
    await exportCadSnapshot({ inputPath: downgradedDrawing, outputPath: output('floorplan.mlcad') });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  console.log('No local DWG found; snapshot generation skipped.');
}

console.log(`CAD assets written to ${outputDirectory}`);
