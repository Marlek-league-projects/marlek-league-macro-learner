/** @jsxImportSource preact */
// The pragma lets `bun test` run from the repo root render this component (test/join-fight.test.ts).
import type { Contact } from '@lml/engine/contracts';
import { playerDefault, type Store } from '../store';
import { championImage, championName, choiceLabel, CONTACT_LABEL, positionLabel, zoneTitle } from './format';

/** The contact's champions with their HP: meeting there, each side sees the other's (contact = vision). */
function Names({ store, ids, hp }: { store: Store; ids: string[]; hp: Record<string, number> }) {
  return (
    <span class="names">
      {ids.map((id) => (
        <span key={id} class="name">
          <img class="sq" src={championImage(store.data, id)} alt="" />
          {championName(store.data, id)}
          {hp[id] !== undefined && <span class="note"> {Math.round(hp[id]!)} PV</span>}
        </span>
      ))}
    </span>
  );
}

/**
 * The player's champions 1 step away from the contact, each with "Rejoindre le combat" / "Rester" (default). A joiner
 * fights with its side and loses its own action this round; it joins one contact at most. The enemy's possible
 * joiners are never listed (fog of war): they show in the log once the contact resolves.
 */
function Joiners({ store, contact }: { store: Store; contact: Contact }) {
  if (contact.nearby.blue.length === 0) return null;
  const joining = store.joinsOf(contact.id);
  const hp = Object.fromEntries((store.view.value?.allies ?? []).map((a) => [a.id, a.hp]));
  return (
    <div class="joiners">
      <div class="note">À 1 pas (rejoindre = pas d'autre action ce round) :</div>
      {contact.nearby.blue.map((id) => {
        const on = joining.includes(id);
        return (
          <div key={id} class="joiner">
            <Names store={store} ids={[id]} hp={hp} />
            <span class="choices">
              <button class={on ? 'on' : ''} onClick={() => store.setJoin(contact.id, id, true)}>Rejoindre le combat</button>
              <button class={on ? '' : 'on'} onClick={() => store.setJoin(contact.id, id, false)}>Rester</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One contact of the round: its zone and positions, who, and the player's choice (preselected: keep on the objective
 * when offered, otherwise the default).
 */
export function ContactPrompt({ store, contact }: { store: Store; contact: Contact }) {
  const chosen = store.choices.value[contact.id]?.blue ?? playerDefault(contact);
  const view = store.view.value;
  const title = view ? zoneTitle(contact, view, store.data, store.roundWindow().start) : positionLabel(store.data, contact.position);
  const where = contact.positions.map((id) => positionLabel(store.data, id)).join(', ');
  return (
    <div class="contact">
      <div>
        <strong>{CONTACT_LABEL[contact.kind]}</strong> · {title}
      </div>
      <div class="note">Positions : {where}</div>
      <div class="note">Toi : <Names store={store} ids={contact.blue} hp={contact.hp} /></div>
      <div class="note">Adversaire : <Names store={store} ids={contact.red} hp={contact.hp} /></div>
      <div class="choices">
        {contact.options.blue.map((choice) => (
          <button key={choice} class={choice === chosen ? 'on' : ''} onClick={() => store.choose(contact.id, choice)}>
            {choiceLabel(contact.kind, choice)}
          </button>
        ))}
      </div>
      <Joiners store={store} contact={contact} />
    </div>
  );
}

/**
 * The round's contact prompts and their confirm button, docked over the map edge that `dock` names so they show
 * without scrolling; the panel scrolls inside itself when there are many.
 */
export function ContactsOverlay({ store, dock }: { store: Store; dock: 'top' | 'bottom' }) {
  return (
    <div class={`contacts-overlay ${dock}`}>
      <div>
        <strong>Contacts</strong>
        <span class="note"> · Tes champions croisent l'adversaire. Choisis la réaction de chacun, et qui les rejoint depuis 1 pas.</span>
      </div>
      <div class="contacts">
        {store.contacts.value.map((c) => <ContactPrompt key={c.id} store={store} contact={c} />)}
      </div>
      <button class="go" onClick={() => store.confirmContacts()}>Valider les choix</button>
    </div>
  );
}
