import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app = process.argv[2];
if (!['admin', 'mini'].includes(app)) throw new Error('App must be admin or mini');

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(directory, '..');
const root = path.join(workspace, '.local/hassan/frontend-dist', app);

const replacements = [
  ['"http://127.0.0.1:5204"', 'window.location.origin'],
  ["'http://127.0.0.1:5204'", 'window.location.origin'],
  ['"http://127.0.0.1:5276"', 'window.location.origin'],
  ["'http://127.0.0.1:5276'", 'window.location.origin'],
  ['"http://127.0.0.1:5104"', 'window.location.origin'],
  ["'http://127.0.0.1:5104'", 'window.location.origin'],
  ['"http://127.0.0.1:5176"', 'window.location.origin'],
  ["'http://127.0.0.1:5176'", 'window.location.origin'],
  ['"http://localhost:5001"', 'window.location.origin'],
  ["'http://localhost:5001'", 'window.location.origin'],
];

function visit(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(filePath)) visit(path.join(filePath, name));
    return;
  }
  if (!/\.(?:html|js|css|json|svg)$/.test(filePath)) return;
  let source = fs.readFileSync(filePath, 'utf8');
  for (const [before, after] of replacements) source = source.replaceAll(before, after);
  fs.writeFileSync(filePath, source);
}

visit(root);
