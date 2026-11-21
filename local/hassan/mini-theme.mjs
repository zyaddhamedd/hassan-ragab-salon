// Presentation hooks are emitted only by the approved Omar Mini Vite config.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const themeStylesheet = fileURLToPath(new URL('./mini-theme.css', import.meta.url));
export const presentationHooks = {
  'mini/App.tsx': [
    ['<div className="mini-shell relative isolate flex ', '<div data-omar-mini-shell="foundation" className="mini-shell relative isolate flex '],
    ['className="mini-sidebar-backdrop"', 'data-omar-mini-backdrop="foundation" className="mini-sidebar-backdrop"'],
  ],
  'mini/components/Sidebar.tsx': [
    ['<div className="pointer-events-none fixed inset-y-0 right-0 z-[120]">', '<div data-omar-mini-sidebar-root="foundation" className="pointer-events-none fixed inset-y-0 right-0 z-[120]">'],
    ['<button\n        onClick={onToggle}', '<button data-omar-mini-toggle="foundation"\n        onClick={onToggle}'],
    ['<aside\n          className=', '<aside data-omar-mini-sidebar="foundation"\n          className='],
    ['<div className="absolute inset-0 scale-75 rounded-full bg-[#E6D690]/5 blur-2xl', '<div data-omar-mini-brand-glow="foundation" className="absolute inset-0 scale-75 rounded-full bg-[#E6D690]/5 blur-2xl'],
    ['<nav className="custom-scrollbar', '<nav data-omar-mini-navigation="foundation" className="custom-scrollbar'],
    ['<button\n                key={item.name}', '<button data-omar-mini-nav-item={activePage === item.name ? \'active\' : \'idle\'}\n                key={item.name}'],
    ['<div className="mr-auto h-1.5 w-1.5', '<div data-omar-mini-active-dot="foundation" className="mr-auto h-1.5 w-1.5'],
    ['<div className="border-t border-white/5 p-6">', '<div data-omar-mini-nav-footer="foundation" className="border-t border-white/5 p-6">'],
    ['<button\n              onClick={onLogout}', '<button data-omar-mini-logout="foundation"\n              onClick={onLogout}'],
  ],
};

export function themeSource(source, relativePath) {
  const hooks = presentationHooks[relativePath];
  if (!hooks) return null;
  let code = source;
  for (const [before, after] of hooks) {
    if (code.split(before).length !== 2 || code.includes(after)) {
      throw new Error('Omar Mini theme hook drift: ' + relativePath);
    }
    code = code.replace(before, after);
  }
  return code;
}

export function omarMiniTheme({workspace, app, mode}) {
  if (app !== 'mini' || !['hassan', 'omar'].includes(mode)) return null;
  return {
    name: 'omar-mini-theme-foundation', enforce: 'pre',
    transform(source, id) {
      const relative = path.relative(workspace, id.split('?')[0]).split(path.sep).join('/');
      if (relative === 'mini/index.tsx') {
        return {code: source + '\nimport ' + JSON.stringify(themeStylesheet) + ';\n', map: null};
      }
      const code = themeSource(source, relative);
      return code === null ? null : {code, map: null};
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes('<html ') || html.includes('data-omar-mini-theme')) {
          throw new Error('Omar Mini theme HTML hook drift');
        }
        return html.replace('<html ', '<html data-omar-mini-theme="foundation" ');
      },
    },
  };
}
