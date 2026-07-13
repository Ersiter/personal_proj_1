import { copyFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
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
      if (code === 0) return resolve();
      reject(new Error(`AutoCAD Core Console failed with exit code ${code}: ${Buffer.concat(output).toString('utf16le')}`));
    });
  });
}

/** Converts a source drawing to AutoCAD 2004 in a disposable build directory. */
export async function prepareCad2004({ inputPath, outputPath, coreConsole = process.env.AUTOCAD_CORE_CONSOLE }) {
  const source = toPath(inputPath);
  const output = toPath(outputPath);
  if (!existsSync(source)) throw new Error(`CAD source drawing was not found: ${source}`);
  if (!coreConsole || !existsSync(coreConsole)) {
    throw new Error('Set AUTOCAD_CORE_CONSOLE to accoreconsole.exe before building the CAD snapshot.');
  }

  const directory = await mkdtemp(join(tmpdir(), 'dai-qidong-cad-2004-'));
  const scriptPath = join(directory, 'save-as-2004.scr');
  const sourceCopy = join(directory, 'source.dwg');
  const convertedDrawing = join(directory, 'floorplan-2004.dwg');
  const saveAsTarget = convertedDrawing.replace(/\\/g, '/');

  try {
    await copyFile(source, sourceCopy);
    await writeFile(
      scriptPath,
      `_.FILEDIA\n0\n_.FIELDEVAL\n31\n_.REGENALL\n_.QSAVE\n_.SAVEAS\n2004\n${saveAsTarget}\n_.QUIT\n`,
      'utf8'
    );
    await runCoreConsole(coreConsole, ['/i', sourceCopy, '/s', scriptPath]);
    if (!existsSync(convertedDrawing) || (await stat(convertedDrawing)).size === 0) {
      throw new Error(`AutoCAD Core Console did not write ${basename(output)}.`);
    }
    await copyFile(convertedDrawing, output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
