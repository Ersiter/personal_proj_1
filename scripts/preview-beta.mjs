import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createServer } from 'node:http';

const root = resolve(import.meta.dirname, '..');
const port = Number.parseInt(process.env.PORT || '4173', 10);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.dwg': 'application/acad',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.mlcad': 'application/vnd.mlightcad.acex-snapshot+binary',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp'
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = resolve(root, `.${pathname}`);

  if (!file.startsWith(`${root}\\`) || !existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] || 'application/octet-stream' });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Open http://127.0.0.1:${port}/web/dai-qidong-scheme-260711-beta.html`);
});
