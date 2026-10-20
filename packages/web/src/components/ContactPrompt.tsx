import type { Contact } from '@lml/engine/contracts';
import type { Store } from '../store';
import { championImage, championName, choiceLabel, CONTACT_LABEL, positionLabel } from './format';

function Names({ store, ids }: { store: Store; ids: string[] }) {
  return (
    <span class="names">
      {ids.map((id) => (
        <span key={id} class="name">
          <img class="sq" src={championImage(store.data, id)} alt="" />
          {championName(store.data, id)}
        </span>
      ))}
    </span>
  );
}

/** One contact of the round: where, who, and the player's choice (the default is preselected). */
export function ContactPrompt({ store, contact }: { store: Store; contact: Contact }) {
  const chosen = store.choices.value[contact.id]?.blue ?? contact.defaults.blue;
  return (
    <div class="contact">
      <div>
        <strong>{CONTACT_LABEL[contact.kind]}</strong> · {positionLabel(store.data, contact.position)}
      </div>
      <div class="note">Toi : <Names store={store} ids={contact.blue} /></div>
      <div class="note">Adversaire : <Names store={store} ids={contact.red} /></div>
      <div class="seg">
        {contact.options.blue.map((choice) => (
          <button key={choice} class={choice === chosen ? 'on' : ''} onClick={() => store.choose(contact.id, choice)}>
            {choiceLabel(contact.kind, choice)}
          </button>
        ))}
      </div>
    </div>
  );
}
