import { cp, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const toPath = (value) => value instanceof URL ? fileURLToPath(value) : value;

function runCoreConsole(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    const output = [];
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => output.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`AutoCAD Core Console failed with exit code ${code}: ${Buffer.concat(output).toString('utf16le')}`));
    });
  });
}

/** Creates an evaluated build-only DWG copy without modifying the source drawing. */
export async function prepareCadDrawing({ inputPath, outputPath, coreConsole = process.env.AUTOCAD_CORE_CONSOLE }) {
  const source = toPath(inputPath);
  const output = toPath(outputPath);
  if (!existsSync(source)) throw new Error(`CAD source drawing was not found: ${source}`);
  if (!coreConsole || !existsSync(coreConsole)) {
    throw new Error('Set AUTOCAD_CORE_CONSOLE to accoreconsole.exe before building the CAD snapshot.');
  }

  await cp(source, output);
  const directory = await mkdtemp(join(tmpdir(), 'dai-qidong-cad-fields-'));
  const scriptPath = join(directory, 'evaluate-fields.scr');

  try {
    await writeFile(scriptPath, '_.FILEDIA\n0\n_.FIELDEVAL\n31\n_.REGENALL\n_.QSAVE\n_.QUIT\n', 'utf8');
    await runCoreConsole(coreConsole, ['/i', output, '/s', scriptPath]);
    if ((await stat(output)).size === 0) throw new Error(`AutoCAD Core Console did not write ${basename(output)}.`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
