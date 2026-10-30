import { useState } from 'preact/hooks';
import type { Store } from '../store';
import type { ObjectivePromptEntry } from './map-marks';
import { championImage, championName, errorText, objectiveActionLabel, positionLabel } from './format';
import { champSq, choices, contactBox, contactGrid, error as errorClass, note, on, overlay } from './ui';

/**
 * At the start of the order phase, one entry per own champion standing on (or moving onto) a pit whose objective is up, being
 * taken or spawning this round: do the objective (a stay order) or give another order (selects the token). Docked over the map edge
 * that `dock` names, like the contacts overlay.
 */
export function ObjectivePrompt({ store, entries, dock }: { store: Store; entries: ObjectivePromptEntry[]; dock: 'top' | 'bottom' }) {
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <div class={overlay(dock)}>
      <div>
        <strong>Objectif</strong>
        <span class={note}> · Ton champion est sur le pit ou s'y rend.</span>
      </div>
      <div class={contactGrid}>
        {entries.map((e) => (
          <div key={e.champion} class={contactBox}>
            <div>
              <img class={champSq} src={championImage(store.data, e.champion)} alt="" />
              <strong>{championName(store.data, e.champion)}</strong> · {positionLabel(store.data, e.pit)}
            </div>
            <div class={choices}>
              <button class={on(true)} onClick={() => run(() => store.doObjective(e.champion))}>
                {objectiveActionLabel(e.objective, e.withScuttle)}
              </button>
              <button onClick={() => run(() => store.otherOrder(e.champion))}>Autre ordre</button>
            </div>
          </div>
        ))}
      </div>
      {error && <div class={errorClass}>{error}</div>}
    </div>
  );
}
