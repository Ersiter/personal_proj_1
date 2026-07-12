import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runnerDirectory = resolve(root, 'node_modules', '@mlightcad', 'cad-html-exporter-cli', 'dist-runner');
const exportRunnerSource = resolve(root, 'src', 'cad-snapshot-export-runner.js');

async function buildExportRunner() {
  const result = await build({
    entryPoints: [exportRunnerSource],
    bundle: true,
    format: 'iife',
    minify: true,
    platform: 'browser',
    target: ['es2022'],
    write: false,
    plugins: [{
      name: 'three-example-extension-compat',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^three\/examples\/jsm\// }, (args) => {
          if (args.path.endsWith('.js')) return undefined;
          return { path: resolve(root, 'node_modules', `${args.path}.js`) };
        });
      }
    }]
  });
  return result.outputFiles[0].text;
}

function startStaticServer(directory, exportRunner) {
  return new Promise((resolveServer, reject) => {
    const server = createServer(async (request, response) => {
      try {
        const pathName = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
        if (pathName === '/') {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end('<!doctype html><div id="cad-root" style="width:1280px;height:720px"></div><script src="/cad-snapshot-export-runner.js"></script>');
          return;
        }
        if (pathName === '/cad-snapshot-export-runner.js') {
          response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
          response.end(exportRunner);
          return;
        }
        const relativePath = pathName === '/' ? 'index.html' : pathName.replace(/^\//, '');
        const file = resolve(directory, relativePath);
        if (!file.startsWith(`${directory}\\`) || !existsSync(file)) {
          response.writeHead(404).end();
          return;
        }
        const contentTypes = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.wasm': 'application/wasm'
        };
        response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' });
        response.end(await readFile(file));
      } catch (error) {
        response.writeHead(500).end(String(error));
      }
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('无法启动 CAD 快照导出服务器。'));
        return;
      }
      resolveServer({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
      });
    });
  });
}

export async function exportCadSnapshot({ inputPath, outputPath }) {
  if (!existsSync(inputPath)) throw new Error(`找不到图纸：${inputPath}`);
  if (!existsSync(resolve(runnerDirectory, 'index.html'))) {
    throw new Error('官方 CAD 快照导出器未安装完整。');
  }

  const drawing = await readFile(inputPath);
  const exportRunner = await buildExportRunner();
  const server = await startStaticServer(runnerDirectory, exportRunner);
  // Use the installed Edge channel by default; callers may override it (for example, `chrome`).
  const channel = process.env.CAD_EXPORT_BROWSER_CHANNEL ?? 'msedge';
  const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });

  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.exportCadSnapshot === 'function');
    const payload = await page.evaluate(async ({ fileName, base64 }) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return window.exportCadSnapshot(fileName, bytes);
    }, {
      fileName: inputPath.split(/[\\/]/).at(-1),
      base64: drawing.toString('base64')
    });

    await writeFile(outputPath, Buffer.from(payload, 'base64'));
  } finally {
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inputPath = resolve(root, 'assets', 'cad', '装修图纸.dwg');
  const outputPath = resolve(root, 'assets', 'cad', 'floorplan.mlcad');
  await exportCadSnapshot({ inputPath, outputPath });
  console.log(`CAD snapshot written to ${outputPath}`);
}
