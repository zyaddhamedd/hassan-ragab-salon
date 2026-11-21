import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { workspaceFocus, workspaceStyles } from './productWorkspaceStyles';

interface Props {
  title: string;
  description: string;
  icon: React.ReactNode;
  isDarkMode: boolean;
  children: React.ReactNode;
}

export default function ProductWorkspaceAction({ title, description, icon, isDarkMode, children }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tone = workspaceStyles(isDarkMode);
  return (
    <section className={tone.panel}>
      <h3>
        <button
          type="button"
          id={`${id}-trigger`}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((value) => !value)}
          className={`flex w-full items-center gap-3 rounded-2xl p-4 text-right ${workspaceFocus}`}
        >
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.warehouse}`}>{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black">{title}</span>
            <span className={`mt-1 block text-xs font-normal ${tone.muted}`}>{description}</span>
          </span>
          <ChevronDown size={16} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </h3>
      {/* Keep forms mounted when collapsed so drafts and destination stay intact. */}
      <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-trigger`} hidden={!open} className={`border-t p-4 ${tone.divider}`}>
        {children}
      </div>
    </section>
  );
}
