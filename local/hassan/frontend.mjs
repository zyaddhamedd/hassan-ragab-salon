// Build/check only: no server-start action is available in this phase.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {workspace} from './frontend-config.mjs';
const [app, action] = process.argv.slice(2);
if (!['admin', 'mini'].includes(app) || !['build', 'typecheck'].includes(action)) throw new Error('Usage: node local/omar/frontend.mjs <admin|mini> <build|typecheck>');
if (fs.realpathSync(process.cwd()) !== workspace) throw new Error('Run from the Omar workspace');
const branch = spawnSync('git', ['branch', '--show-current'], {encoding: 'utf8'});
if (branch.status !== 0 || branch.stdout.trim() !== 'feat/omar-fahim-setup') throw new Error('Wrong Omar branch');
const root = path.join(workspace, app);
const args = action === 'build'
  ? [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', path.join(workspace, `local/omar/${app}.vite.config.mjs`), '--mode', 'omar']
  : [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--project', path.join(root, 'tsconfig.json')];
const result = spawnSync(process.execPath, args, {cwd: root, stdio: 'inherit', env: {PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8'}});
process.exit(result.status ?? 1);
