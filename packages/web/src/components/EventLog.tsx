import type { Store } from '../store';
import { eventLines } from './format';

/** The last round's events (already fog-filtered) and, in teaching mode, its explanations. */
export function EventLog({ store }: { store: Store }) {
  const lines = eventLines(store.lastEvents.value, store.data);
  const explanations = store.explanations.value;
  return (
    <>
      <div>
        <h3>Ce qui s'est passé</h3>
        {lines.length === 0 ? (
          <div class="note">Rien de visible ce round.</div>
        ) : (
          <ul class="log">
            {lines.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        )}
      </div>
      {store.settings.value.teaching && (
        <div>
          <h3>Explications</h3>
          {explanations.length === 0 ? (
            <div class="note">Rien à signaler sur le tempo ce round.</div>
          ) : (
            explanations.map((x, i) => (
              <div key={i} class="lesson">
                {x.roundsLost > 0 && <span class="badge">−{x.roundsLost} round{x.roundsLost > 1 ? 's' : ''}</span>}
                {x.text}
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
