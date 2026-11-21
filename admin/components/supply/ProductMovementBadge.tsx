import React from 'react';
import { movementPresentation } from './productMovementPresentation';

interface Props { type: string; isDarkMode: boolean; legacyLabels?: boolean }

export default function ProductMovementBadge({ type, isDarkMode, legacyLabels = false }: Props) {
  const presentation = movementPresentation(type);
  return <span className={`inline-flex max-w-full items-center break-words rounded-md border px-2 py-1 text-xs font-bold ${isDarkMode ? presentation.dark : presentation.light}`}>
    {legacyLabels ? presentation.legacyLabel || presentation.label : presentation.label}
  </span>;
}
