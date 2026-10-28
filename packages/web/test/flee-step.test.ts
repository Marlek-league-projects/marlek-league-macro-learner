import { describe, expect, test } from 'bun:test';
import type { ComponentChildren, VNode } from 'preact';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import type { Contact, ContactChoices, GameEngine } from '@lml/engine/contracts';
import { ContactPrompt } from '../src/components/ContactPrompt';
import { positionLabel } from '../src/components/format';
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

/** A store whose engine reports one prompted bot river contact (blue jungler against red jungler) and records the choices sent. */
function rigged() {
  let sent: ContactChoices | null = null;
  let ids: Record<string, string> = {};
  const contact = (): Contact => ({
    id: 'river-bot', position: 'scuttle-bot', positions: ['scuttle-bot'], kind: 'objective', blue: [ids.bj!], red: [ids.rj!],
    options: { blue: ['fight', 'flee'], red: ['fight', 'flee'] }, defaults: { blue: 'fight', red: 'fight' }, invader: null,
    auto: false, arrivals: { [ids.bj!]: 'scuttle-bot', [ids.rj!]: 'scuttle-bot' }, hp: { [ids.bj!]: 100, [ids.rj!]: 100 },
    nearby: { blue: [], red: [] },
  });
  const spy: GameEngine = {
    ...engine,
    detectContacts: () => [contact()],
    aiAnswers: () => ({ 'river-bot': { red: 'fight' } }),
    resolveRound: (s, d, o, choices) => {
      sent = choices;
      return engine.resolveRound(s, d, o, {});
    },
  };
  const store = createStore(data, spy);
  store.start({ rank: 'gold', teaching: false, seed: 1 });
  store.confirmPlacement();
  const v = store.view.value!;
  ids = { bj: v.allies.find((c) => c.role === 'jungle')!.id, rj: v.enemies.find((c) => c.role === 'jungle')!.id };
  store.confirmRound();
  return { store, bj: ids.bj!, sent: () => sent };
}

describe('picking where to flee (web)', () => {
  test('"Fuir" waits for a map click on one of the engine\'s flee steps', () => {
    const { store, bj } = rigged();
    expect(store.fleePick.value).toBeNull();
    store.choose('river-bot', 'flee');
    expect(store.fleePick.value).toEqual({ contact: 'river-bot', champion: bj });
    const steps = store.fleeSteps('river-bot', bj);
    expect(steps.length).toBeGreaterThan(1);
    expect(steps).not.toContain('scuttle-bot');
  });

  test('the picked step is sent as fleeTo; none picked sends none (the automatic step)', () => {
    const { store, bj, sent } = rigged();
    store.choose('river-bot', 'flee');
    const to = store.fleeSteps('river-bot', bj)[1]!;
    store.setFleeTo('river-bot', bj, to);
    expect(store.fleeToOf('river-bot', bj)).toBe(to);
    expect(store.fleePick.value).toBeNull();
    store.confirmContacts();
    expect(sent()!['river-bot']).toEqual({ blue: 'flee', red: 'fight', joins: { blue: [], red: [] }, fleeTo: { [bj]: to } });

    const other = rigged();
    other.store.choose('river-bot', 'flee');
    other.store.confirmContacts();
    expect(other.sent()!['river-bot']!.fleeTo).toBeUndefined();
  });

  test('a step not allowed throws; choosing another reaction drops the pick', () => {
    const { store, bj, sent } = rigged();
    store.choose('river-bot', 'flee');
    expect(() => store.setFleeTo('river-bot', bj, 'scuttle-bot')).toThrow();
    store.setFleeTo('river-bot', bj, store.fleeSteps('river-bot', bj)[0]!);
    store.choose('river-bot', 'fight');
    expect(store.fleeToOf('river-bot', bj)).toBeNull();
    expect(store.fleePick.value).toBeNull();
    store.confirmContacts();
    expect(sent()!['river-bot']!.fleeTo).toBeUndefined();
  });

  test('the prompt tells where each fleeing champion goes', () => {
    const { store, bj } = rigged();
    store.choose('river-bot', 'flee');
    const shown = store.contacts.value[0]!;
    expect(text(ContactPrompt({ store, contact: shown }))).toContain('Clique une case pour choisir où fuir');
    const to = store.fleeSteps('river-bot', bj)[1]!;
    store.setFleeTo('river-bot', bj, to);
    expect(text(ContactPrompt({ store, contact: shown }))).toContain(`Fuite vers ${positionLabel(data, to)}`);
  });
});
