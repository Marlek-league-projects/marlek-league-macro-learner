import { useState } from 'preact/hooks';
import type { Rank } from '@lml/data/contracts';
import type { Store } from '../store';

const randomSeed = (): number => Math.floor(Math.random() * 1_000_000_000);

export function StartScreen({ store }: { store: Store }) {
  const initial = store.settings.value;
  const [rank, setRank] = useState<Rank>(initial.rank);
  const [teaching, setTeaching] = useState(initial.teaching);
  const [seed, setSeed] = useState(randomSeed);

  return (
    <div class="start">
      <h2>Nouvelle partie contre l'IA</h2>
      <p class="note">
        Place d'abord tes champions (round 0), puis donne un ordre à chacun d'eux à chaque round et valide. L'IA
        joue avec le brouillard de guerre et fait les erreurs typiques de son rang.
      </p>
      <label class="field">
        <span>Rang de l'IA</span>
        <select value={rank} onChange={(e) => setRank((e.currentTarget as HTMLSelectElement).value as Rank)}>
          {store.data.aiProfiles.map((p) => (
            <option key={p.rank} value={p.rank}>{p.label}</option>
          ))}
        </select>
      </label>
      <div class="field">
        <span>Mode didactique</span>
        <div class="seg">
          <button class={teaching ? 'on' : ''} onClick={() => setTeaching(true)}>Activé</button>
          <button class={teaching ? '' : 'on'} onClick={() => setTeaching(false)}>Désactivé</button>
        </div>
      </div>
      <label class="field">
        <span>Graine</span>
        <div class="seedrow">
          <input
            type="number"
            min={0}
            value={seed}
            onInput={(e) => setSeed(Math.max(0, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 0)))}
          />
          <button type="button" title="Nouvelle graine" onClick={() => setSeed(randomSeed())}>↻</button>
        </div>
      </label>
      <button class="go" onClick={() => store.start({ rank, teaching, seed })}>Lancer la partie</button>
    </div>
  );
}
