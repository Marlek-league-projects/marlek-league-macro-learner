import type { Store } from '../store';
import { eventLines } from './format';
import { heading, note } from './ui';

/** The last round's events (already fog-filtered) and, in teaching mode, its explanations. */
export function EventLog({ store }: { store: Store }) {
  const lines = eventLines(store.lastEvents.value, store.data);
  const explanations = store.explanations.value;
  return (
    <>
      <div>
        <h3 class={heading}>Ce qui s'est passé</h3>
        {lines.length === 0 ? (
          <div class={note}>Rien de visible ce round.</div>
        ) : (
          <ul class="m-0 max-h-[260px] list-disc overflow-auto pl-4 text-[12px] *:my-0.5">
            {lines.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        )}
      </div>
      {store.settings.value.teaching && (
        <div>
          <h3 class={heading}>Explications</h3>
          {explanations.length === 0 ? (
            <div class={note}>Rien à signaler sur le tempo ce round.</div>
          ) : (
            explanations.map((x, i) => (
              <div key={i} class="my-1 text-[12px]">
                {x.roundsLost > 0 && <span class="mr-[5px] inline-block rounded bg-red-900 px-[5px] text-[11px] font-bold text-red-200">−{x.roundsLost} round{x.roundsLost > 1 ? 's' : ''}</span>}
                {x.text}
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
