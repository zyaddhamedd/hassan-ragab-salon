// Dependency-free static production build. No servers, env files or network.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const source = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(source, '../../..');
const output = path.join(workspace, '.local/omar/staff-build');
const parent = await fs.realpath(path.dirname(output));
if (parent !== path.join(workspace, '.local/omar')) throw new Error('Build output must remain inside private standalone artifacts');
const stats = await fs.lstat(output).catch(() => null);
if (stats?.isSymbolicLink()) throw new Error('Refusing redirected output');
const modules = ['app.mjs', 'client.mjs', 'proof.mjs', 'vault.mjs', 'attendance.mjs', 'icons.mjs'];
for (const name of modules) execFileSync(process.execPath, ['--check', path.join(source, name)]);
await fs.mkdir(path.join(output, 'assets'), {recursive: true});
for (const name of modules) await fs.copyFile(path.join(source, name), path.join(output, name));
await fs.copyFile(path.join(source, 'style.css'), path.join(output, 'assets/staff.css'));
await fs.copyFile(path.join(source, '../prototypes/staff/style.css'), path.join(output, 'assets/prototype.css'));
for (const asset of ['cashier-header-logo-white-tight.svg', 'mini-print-logo.svg', 'mini-favicon.svg']) await fs.copyFile(path.join(source, '../assets', asset), path.join(output, 'assets', asset));
const html = (await fs.readFile(path.join(source, 'index.html'), 'utf8')).replaceAll('../assets/', './assets/')
  .replace('href="../prototypes/staff/style.css"', 'href="./assets/prototype.css"').replace('href="style.css"', 'href="./assets/staff.css"');
await fs.writeFile(path.join(output, 'index.html'), html);
const files = [...modules, 'index.html', 'assets/staff.css', 'assets/prototype.css', 'assets/cashier-header-logo-white-tight.svg', 'assets/mini-print-logo.svg', 'assets/mini-favicon.svg'];
const manifest = {};
for (const name of files) manifest[name] = createHash('sha256').update(await fs.readFile(path.join(output, name))).digest('hex');
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Staff production build:', output, '(' + files.length + ' files, no external assets)');
