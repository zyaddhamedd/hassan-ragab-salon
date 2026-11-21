import React, { useEffect, useRef, useState } from 'react';
import { moveId } from './preferences';

type Item = { id: number; name: string };
type Props<T extends Item> = {
  items: T[]; editing: boolean; className?: string; style?: React.CSSProperties;
  onOrder: (ids: number[]) => void; renderItem: (item: T) => React.ReactNode;
  popular?: (id: number) => boolean; onPopular?: (id: number) => void;
  scrollPosition?: React.MutableRefObject<number>;
};
// Native HTML drag owns the mouse/ghost. Only this inline grid previews a move
// with transforms; DOM order and saved data are committed on an accepted drop.
export default function InlineCards<T extends Item>({ items, editing, className, style, onOrder, renderItem, popular, onPopular, scrollPosition }: Props<T>) {
  const grid = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const live = useRef<HTMLSpanElement>(null);
  const announce = (text: string) => { if (live.current) live.current.textContent = text; };
  const drag = useRef<{ id: number; original: number[]; next: number[]; boxes: { x: number; y: number; width: number; height: number }[]; nodes: HTMLElement[]; origin: {x:number;y:number}; ancestors: {node:HTMLElement;top:number;left:number}[]; owner: HTMLElement | null; ownerBounds: {top:number;bottom:number;left:number;right:number} | null; target: number; pointer: { x: number; y: number }; keyboard: boolean } | null>(null);
  const frame = useRef(0);
  const clearPreview = () => {
    const session = drag.current, changed: HTMLElement[] = [];
    session?.nodes.forEach(node => { if (node.style.transform) { node.style.transition = 'none'; node.style.transform = ''; changed.push(node); } });
    const selected = session?.nodes[session.original.indexOf(session.id)];
    selected?.removeAttribute('data-inline-dragging');
    selected?.querySelector('[data-inline-handle]')?.setAttribute('aria-pressed', 'false');
    return changed;
  };
  const restoreTransitions = (nodes: HTMLElement[]) => requestAnimationFrame(() => nodes.forEach(node => { node.style.transition = ''; }));
  const callbacks = useRef({ items, onOrder }); callbacks.current = { items, onOrder };
  const cancel = () => {
    const keyboard = drag.current?.keyboard;
    if (keyboard) callbacks.current.onOrder(drag.current!.original);
    const nodes = clearPreview();
    drag.current = null; cancelAnimationFrame(frame.current); frame.current = 0;
    restoreTransitions(nodes); if (keyboard) setActive(null);
  };
  const focusHandle = (id: number) => requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-inline-handle="${id}"]`)?.focus());
  const hit = () => {
    const session = drag.current;
    if (!session || session.keyboard) return;
    // Cached geometry + cheap scroll offsets. No layout read on a pointer frame.
    let left = session.origin.x, top = session.origin.y;
    for (const ancestor of session.ancestors) { left -= ancestor.node.scrollLeft - ancestor.left; top -= ancestor.node.scrollTop - ancestor.top; }
    const x = session.pointer.x - left, y = session.pointer.y - top;
    let closest = 0, distance = Infinity;
    session.boxes.forEach((box, index) => {
      const d = (x - box.x - box.width / 2) ** 2 + (y - box.y - box.height / 2) ** 2;
      if (d < distance) { distance = d; closest = index; }
    });
    if (closest === session.target) return;
    session.target = closest;
    session.next = moveId(session.original, session.id, closest);
    const ranks = new Map(session.next.map((id, index) => [id, index]));
    session.nodes.forEach((node, index) => {
      const destination = ranks.get(session.original[index])!;
      const from = session.boxes[index], to = session.boxes[destination];
      const transform = destination === index ? '' : `translate(${to.x-from.x}px, ${to.y-from.y}px)`;
      if (node.style.transform !== transform) node.style.transform = transform;
    });
  };
  const currentOwnerBounds = (session: NonNullable<typeof drag.current>) => {
    const bounds = session.ownerBounds; if (!bounds) return null;
    const aboveOwner = session.ancestors.slice(session.ancestors.findIndex(a => a.node === session.owner) + 1);
    const dy = aboveOwner.reduce((sum,a) => sum+a.node.scrollTop-a.top,0);
    const dx = aboveOwner.reduce((sum,a) => sum+a.node.scrollLeft-a.left,0);
    return {top:bounds.top-dy,bottom:bounds.bottom-dy,left:bounds.left-dx,right:bounds.right-dx};
  };
  const scroll = () => {
    frame.current = 0;
    const session = drag.current;
    if (!session || session.keyboard) return;
    // Read scroll offsets before writes, then preview once per animation frame.
    const owner = session.owner, bounds = currentOwnerBounds(session);
    let moved = false;
    if (owner && bounds) {
      const y = session.pointer.y;
      const delta = y < bounds.top + 45 ? -36 : y > bounds.bottom - 45 ? 36 : 0;
      if (delta && session.pointer.x >= bounds.left && session.pointer.x <= bounds.right) {
        const before = owner.scrollTop; owner.scrollTop += delta; moved = owner.scrollTop !== before;
      }
    }
    hit();
    if (moved) frame.current = requestAnimationFrame(scroll);
  };
  const start = (id: number, keyboard: boolean, pointer = { x: 0, y: 0 }) => {
    const node = grid.current; if (!node || drag.current) return;
    const nodes = Array.from(node.children) as HTMLElement[];
    const bounds = node.getBoundingClientRect();
    const boxes = nodes.map(child => { const box = child.getBoundingClientRect(); return { x: box.left - bounds.left, y: box.top - bounds.top, width: box.width, height: box.height }; });
    const original = items.map(item => item.id);
    const ancestors: {node:HTMLElement;top:number;left:number}[] = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.push({node:parent,top:parent.scrollTop,left:parent.scrollLeft});
    const owner = node.closest<HTMLElement>('.omar-inline-scroll') || node.parentElement?.closest<HTMLElement>('.mini-scroll-y') || null;
    const ownerBounds = owner?.getBoundingClientRect() || null;
    drag.current = { id, original, next: original, boxes, nodes, origin:{x:bounds.left,y:bounds.top}, ancestors, owner, ownerBounds, target:original.indexOf(id), pointer, keyboard };
    if (keyboard) setActive(id);
    else { const selected=nodes[original.indexOf(id)]; selected.dataset.inlineDragging='true'; selected.querySelector('[data-inline-handle]')?.setAttribute('aria-pressed','true'); }
    announce(`تم اختيار ${items.find(item => item.id === id)?.name} للترتيب`);
    if (!keyboard) frame.current = requestAnimationFrame(scroll);
  };
  const finish = () => {
    const session = drag.current; if (!session) return;
    // Remove preview transforms in the same task as the keyed order commit.
    // Suppress the reverse CSS transition to avoid a second hop on release.
    const nodes = clearPreview(); callbacks.current.onOrder(session.next); const id = session.id;
    drag.current = null; cancelAnimationFrame(frame.current); frame.current = 0;
    restoreTransitions(nodes); if (session.keyboard) setActive(null); announce('تم تغيير الترتيب. احفظ لاعتماده.'); focusHandle(id);
  };
  const orderSignature = items.map(item => item.id).join(',');
  useEffect(() => {
    const session = drag.current;
    if (session && orderSignature !== (session.keyboard ? session.next : session.original).join(',')) {
      // Reset or an external order change wins over an unfinished preview.
      const nodes = clearPreview(); drag.current = null; cancelAnimationFrame(frame.current); frame.current = 0; restoreTransitions(nodes); setActive(null);
    }
  }, [orderSignature]);
  const membership = items.map(item => item.id).sort((a,b) => a-b).join(',');
  useEffect(() => {
    if (!editing) return;
    const resize = () => cancel();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopImmediatePropagation(); const id = drag.current.id; cancel(); focusHandle(id); } };
    let previousSize: string | undefined;
    const observer = new ResizeObserver(entries => { const box = entries[0]?.contentRect; const size = `${box?.width}:${box?.height}`; if (previousSize !== undefined && size !== previousSize) cancel(); previousSize = size; });
    if (grid.current) observer.observe(grid.current);
    window.addEventListener('resize', resize); window.addEventListener('keydown', escape, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); window.removeEventListener('keydown', escape, true); cancelAnimationFrame(frame.current); if (drag.current?.keyboard) callbacks.current.onOrder(drag.current.original); const nodes=clearPreview(); restoreTransitions(nodes); drag.current = null; };
  }, [editing, membership]);
  useEffect(() => { if (!drag.current) setActive(null); }, [membership]);
  useEffect(() => { if (scrollPosition && grid.current?.parentElement?.classList.contains('omar-inline-scroll')) grid.current.parentElement.scrollTop = scrollPosition.current; }, []);
  const handlers = editing ? {
    onDragOver: (event: React.DragEvent) => { if (!drag.current || drag.current.keyboard) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; drag.current.pointer = { x: event.clientX, y: event.clientY }; if (!frame.current) frame.current = requestAnimationFrame(scroll); },
    onDrop: (event: React.DragEvent) => { if (!drag.current) return; event.preventDefault(); if (drag.current && !drag.current.keyboard) { drag.current.pointer={x:event.clientX,y:event.clientY}; hit(); } finish(); },
  } : {};
  return <>
    <div ref={grid} className={className} style={style} {...handlers}>{items.map((item) => {
      if (!editing) return renderItem(item);
      return <div key={item.id} data-inline-item={item.id} data-inline-dragging={active === item.id || undefined} className="omar-inline-item">
        <div className="omar-inline-content">{renderItem(item)}</div>
        <button type="button" className="omar-inline-handle" data-inline-handle={item.id} draggable aria-label={`ترتيب ${item.name}`} aria-pressed={active === item.id} title="اسحب للترتيب، أو اضغط Space ثم الأسهم وEnter" onClick={event => { event.preventDefault(); event.stopPropagation(); }}
          onDragStart={event => { event.stopPropagation(); start(item.id, false, {x:event.clientX,y:event.clientY}); event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('text/plain',String(item.id)); const card=event.currentTarget.parentElement; if(card) { const box=drag.current?.boxes[items.findIndex(candidate=>candidate.id===item.id)] || card.getBoundingClientRect(); const origin=drag.current?.origin; event.dataTransfer.setDragImage(card,event.clientX-(origin ? origin.x+box.x : card.getBoundingClientRect().left),event.clientY-(origin ? origin.y+box.y : card.getBoundingClientRect().top)); } }}
          onDragEnd={() => { if (drag.current) cancel(); }}
          onKeyDown={event => {
            if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (drag.current?.keyboard) finish(); else start(item.id,true); return; }
            const session = drag.current; if (!session?.keyboard || session.id !== item.id) return;
            const columns = Math.max(1, getComputedStyle(grid.current!).gridTemplateColumns.split(' ').length);
            const rtl = getComputedStyle(grid.current!).direction === 'rtl';
            const at = session.next.indexOf(item.id);
            const delta = event.key === 'ArrowDown' ? columns : event.key === 'ArrowUp' ? -columns : event.key === 'ArrowLeft' ? (rtl?1:-1) : event.key === 'ArrowRight' ? (rtl?-1:1) : 0;
            if (!delta && event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault(); event.stopPropagation();
            const target = event.key === 'Home' ? 0 : event.key === 'End' ? session.next.length-1 : Math.max(0,Math.min(session.next.length-1,at+delta));
            session.next = moveId(session.next,item.id,target); callbacks.current.onOrder(session.next); focusHandle(item.id); announce(`الموضع ${target+1} من ${items.length}`);
          }}>⠿</button>
        {onPopular && <button type="button" className="omar-inline-popular" aria-label={`POPULAR ${item.name}`} aria-pressed={popular?.(item.id) || false} onClick={event => { event.preventDefault(); event.stopPropagation(); onPopular(item.id); }}>{popular?.(item.id) ? '★' : '☆'}</button>}
      </div>;
    })}</div>
    {editing && <span ref={live} className="omar-inline-sr" role="status" aria-live="polite" />}
  </>;
}
