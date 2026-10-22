import { describe, expect, test } from 'bun:test';
import type { ComponentChildren, VNode } from 'preact';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import type { Contact, ContactChoices, GameEngine } from '@lml/engine/contracts';
import { ContactPrompt } from '../src/components/ContactPrompt';
import { championName, eventText } from '../src/components/format';
import { createStore } from '../src/store';

const data = loadGameData();
const engine = createEngine();

/** The text of a rendered tree, function components expanded (none of them uses hooks). */
function text(node: ComponentChildren): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  const v = node as VNode<{ children?: ComponentChildren }>;
  if (typeof v.type === 'function') return text((v.type as (p: unknown) => ComponentChildren)(v.props));
  return text(v.props.children);
}

/**
 * A store whose engine reports one prompted river contact (`contacts`), the red AI joining with its mid, and that
 * records the contact choices handed to `resolveRound` (then resolves the real round with the defaults).
 */
function rigged(build: (ids: Record<string, string>) => Contact[]) {
  let sent: ContactChoices | null = null;
  let ids: Record<string, string> = {};
  const spy: GameEngine = {
    ...engine,
    detectContacts: () => build(ids),
    aiAnswers: (_v, _d, contacts) =>
      Object.fromEntries(contacts.map((c) => [c.id, { red: 'fight' as const, joins: { red: c.nearby.red } }])),
    resolveRound: (s, d, o, choices) => {
      sent = choices;
      return engine.resolveRound(s, d, o, {});
    },
  };
  const store = createStore(data, spy);
  store.start({ rank: 'gold', teaching: false, seed: 1 });
  const v = store.view.value!;
  const ally = (role: string) => v.allies.find((c) => c.role === role)!.id;
  const enemy = (role: string) => v.enemies.find((c) => c.role === role)!.id;
  ids = { bj: ally('jungle'), bm: ally('mid'), rj: enemy('jungle'), rm: enemy('mid') };
  return { store, ids, sent: () => sent };
}

const contact = (id: string, ids: Record<string, string>): Contact => ({
  id, position: 'scuttle-bot', positions: ['scuttle-bot'], kind: 'objective', blue: [ids.bj!], red: [ids.rj!],
  options: { blue: ['fight', 'flee'], red: ['fight', 'flee'] }, defaults: { blue: 'fight', red: 'fight' },
  invader: null, auto: false, hp: { [ids.bj!]: 100, [ids.rj!]: 100 }, nearby: { blue: [ids.bm!], red: [ids.rm!] },
});

describe('joining a fight 1 step away (web)', () => {
  test('the store passes both sides\' joins to the engine', () => {
    const { store, ids, sent } = rigged((ids) => [contact('river-bot', ids)]);
    store.confirmRound();
    expect(store.screen.value).toBe('contacts');
    expect(store.joinsOf('river-bot')).toEqual([]);
    store.setJoin('river-bot', ids.bm!, true);
    store.choose('river-bot', 'flee');
    expect(store.joinsOf('river-bot')).toEqual([ids.bm!]);
    store.confirmContacts();
    expect(sent()!['river-bot']).toEqual({ blue: 'flee', red: 'fight', joins: { blue: [ids.bm!], red: [ids.rm!] } });
  });

  test('"Rester" (the default) sends no join; a champion joins one contact at most', () => {
    const { store, ids, sent } = rigged((ids) => [contact('river-bot', ids), contact('river-top', ids)]);
    store.confirmRound();
    store.setJoin('river-bot', ids.bm!, true);
    store.setJoin('river-top', ids.bm!, true);
    expect(store.joinsOf('river-bot')).toEqual([]);
    expect(store.joinsOf('river-top')).toEqual([ids.bm!]);
    store.setJoin('river-top', ids.bm!, false);
    expect(store.joinsOf('river-top')).toEqual([]);
    expect(() => store.setJoin('river-top', ids.rm!, true)).toThrow();
    store.confirmContacts();
    expect(sent()!['river-bot']!.joins!.blue).toEqual([]);
    expect(sent()!['river-top']!.joins!.blue).toEqual([]);
  });

  test('the prompt lists the player\'s nearby champions, never the enemy\'s (fog of war)', () => {
    const { store, ids } = rigged((ids) => [contact('river-bot', ids)]);
    store.confirmRound();
    const shown = store.contacts.value[0]!;
    expect(shown.nearby).toEqual({ blue: [ids.bm!], red: [] });
    const out = text(ContactPrompt({ store, contact: shown }));
    expect(out).toContain(championName(data, ids.bm!));
    expect(out).toContain('Rejoindre le combat');
    expect(out).toContain('Rester');
    expect(out).not.toContain(championName(data, ids.rm!));
  });

  test('the log tells who joined', () => {
    const line = eventText({ type: 'joined', champion: 'Galio', side: 'blue', from: 'krugs-blue', position: 'scuttle-bot' }, data);
    expect(line).toContain('rejoint le combat');
    expect(line).toContain(championName(data, 'Galio'));
  });
});
