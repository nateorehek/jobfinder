import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/demo.js', ['demo.js', 'text/javascript; charset=utf-8']],
  ['/fields.js', ['fields.js', 'text/javascript; charset=utf-8']],
  ['/mark.svg', ['mark.svg', 'image/svg+xml']],
]);
export async function staticFile(req, res, path) {
  const file = files.get(path);
  if (!file || req.method !== 'GET') {
    res.writeHead(404).end('Not found');
    return;
  }
  const data = await readFile(new URL('./public/' + file[0], import.meta.url));
  res.writeHead(200, { 'Content-Type': file[1] }).end(data);
}

if (import.meta.main) {
  createServer((req, res) => staticFile(req, res, new URL(req.url, 'http://localhost').pathname))
    .listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => {
      console.log('Fieldwork listening on port ' + (process.env.PORT || 3000));
    });
}
