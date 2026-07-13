import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { exportCadSnapshot } from '../scripts/export-cad-snapshot.mjs';
import { prepareCadDrawing } from '../scripts/prepare-cad-drawing.mjs';

const root = new URL('../', import.meta.url);
const cadDirectory = new URL('assets/cad/', root);
const coreConsole = process.env.AUTOCAD_CORE_CONSOLE;

test('field-materialized drawing exports the evaluated area geometry', { skip: !coreConsole }, async () => {
  const drawingName = (await readdir(cadDirectory)).find((name) => name.endsWith('.dwg'));
  assert.ok(drawingName, 'the CAD fixture must be available');

  const sourcePath = new URL(`assets/cad/${drawingName}`, root);
  const sourceBytes = await readFile(sourcePath);
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
  const directory = await mkdtemp(join(tmpdir(), 'dai-qidong-cad-test-'));
  const preparedPath = join(directory, 'field-materialized.dwg');
  const snapshotPath = join(directory, 'floorplan.mlcad');

  try {
    await prepareCadDrawing({ inputPath: sourcePath, outputPath: preparedPath, coreConsole });
    await exportCadSnapshot({ inputPath: preparedPath, outputPath: snapshotPath });

    assert.equal(
      createHash('sha256').update(await readFile(sourcePath)).digest('hex'),
      sourceHash,
      'building must not alter the source DWG'
    );
    assert.ok(
      (await stat(snapshotPath)).size > 2_100_000,
      'the snapshot must retain the evaluated area-field geometry'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
