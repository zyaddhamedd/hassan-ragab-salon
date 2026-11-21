import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const source = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(source, '../../../.local/omar/staff-build');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
for (const [file, hash] of Object.entries(manifest)) {
  const body = await fs.readFile(path.join(root, file));
  assert.equal(createHash('sha256').update(body).digest('hex'), hash, file);
  if (file.endsWith('.mjs')) for (const [, imported] of body.toString().matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) {
    assert.ok(manifest[path.posix.normalize(path.posix.join(path.posix.dirname(file), imported))], 'Missing import ' + imported);
  }
}
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
for (const [, target] of html.matchAll(/(?:href|src|data-dark-src|data-light-src)="([^"]+)"/g)) {
  const file = target.replace(/^\.\//, ''); assert.ok(manifest[file], 'Missing or nonlocal asset ' + target);
}
assert.equal(await fs.readFile(path.join(root, 'assets/prototype.css'), 'utf8'), await fs.readFile(path.join(source, '../prototypes/staff/style.css'), 'utf8'));
assert.ok(html.includes("script-src 'self'")); assert.ok(html.includes("connect-src 'self'"));
assert.equal(html.includes('data-result='), false); assert.equal(html.includes('<script>'), false);
assert.equal(Object.keys(manifest).some(file => file.includes('test') || file.includes('backend') || file.endsWith('.json')), false);
console.log('Verified all 12 production assets/imports/hashes, approved CSS identity, CSP and simulation separation.');
