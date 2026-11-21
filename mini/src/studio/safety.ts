// One synchronous boundary shared by Studio entry and operational callbacks.
// Nested operations (service -> draft) are counted without changing algorithms.
export function createStudioBoundary() {
  let editing = false;
  let pending = 0;
  return {
    get editing() { return editing; },
    get pending() { return pending; },
    enter() { if (editing || pending) return false; editing = true; return true; },
    leave() { editing = false; },
    async run<T>(operation: () => Promise<T>): Promise<T | undefined> {
      if (editing) return undefined;
      pending += 1;
      try { return await operation(); } finally { pending -= 1; }
    },
  };
}
export function isStudioShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.key !== 'F2' || !event.shiftKey || event.altKey) return false;
  if (!(event.ctrlKey !== event.metaKey)) return false;
  return !event.composedPath().some(target => target instanceof HTMLElement && (
    target.matches('input, textarea, select, [role="textbox"]') || target.isContentEditable
  ));
}
