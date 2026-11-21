// Local workspace presentation only; no stock/status calculations belong here.
export const workspaceFocus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E53935]';

export const workspaceStyles = (dark: boolean) => ({
  panel: `rounded-2xl border ${dark ? 'border-white/[0.08] bg-[#151515] text-white' : 'border-gray-200 bg-white text-gray-900'}`,
  muted: dark ? 'text-white/60' : 'text-gray-600',
  subtle: dark ? 'bg-white/[0.03]' : 'bg-gray-50',
  divider: dark ? 'border-white/[0.08]' : 'border-gray-200',
  button: `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${workspaceFocus} ${dark ? 'border-white/10 text-white/80 hover:bg-white/5' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`,
  field: `w-full min-w-0 rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-[#E53935] focus:ring-1 focus:ring-[#E53935] ${dark ? 'border-white/10 bg-[#101010] text-white placeholder:text-white/40' : 'border-gray-300 bg-white text-gray-900 placeholder:text-gray-400'}`,
  healthy: dark ? 'bg-emerald-500/10 text-emerald-300' : 'bg-emerald-50 text-emerald-800',
  low: dark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-800',
  unavailable: dark ? 'bg-white/[0.06] text-white/60' : 'bg-gray-100 text-gray-600',
  expired: dark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-800',
  warehouse: dark ? 'bg-[#E6D690]/10 text-[#E6D690]' : 'bg-amber-50 text-amber-900',
});
