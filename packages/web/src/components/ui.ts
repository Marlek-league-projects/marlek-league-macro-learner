// Tailwind class sets shared by several components.

/** A side panel: round summary, game over columns. */
export const panel = 'flex flex-col gap-2.5 rounded-[10px] border border-line bg-panel px-3 py-2.5 text-[13px]';
/** A panel's section title. */
export const heading = 'mb-0.5 text-[13px] font-semibold uppercase tracking-[.04em] text-mut';
export const note = 'text-[12px] text-mut';
export const error = 'text-[12px] text-red-400';

/** The main call to action (validate, next round). */
export const go = 'border-go bg-go p-[9px] font-semibold';
/** A toggle button's pressed look. */
export const on = (active: boolean): string => (active ? 'border-accent bg-accent' : '');
export const wide = 'my-0.5 w-full';

/** Buttons sharing a row evenly. */
export const seg = 'flex gap-1 *:flex-1';
/** Two columns of buttons whose labels may wrap. */
export const choices = 'grid grid-cols-2 gap-1 *:min-w-0 *:whitespace-normal';

/** Inline icons: the role icon and the champion square. */
export const roleIco = 'mr-[3px] inline-block size-4 align-[-3px]';
export const champSq = 'mr-1 inline-block size-4 rounded-[3px] align-[-3px]';

/** A panel docked over the map edge that `dock` names. */
export const overlay = (dock: 'top' | 'bottom'): string =>
  `absolute inset-x-3 z-6 flex max-h-[48%] flex-col gap-2 overflow-auto rounded-lg border border-line-strong bg-panel/92 px-2.5 py-2 text-[13px] shadow-[0_6px_18px_#000a] ${dock === 'top' ? 'top-3' : 'bottom-3'}`;
export const contactGrid = 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2';
export const contactBox = 'flex flex-col gap-1 rounded-lg border border-line bg-bg p-2';
