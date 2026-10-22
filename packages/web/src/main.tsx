import { render } from 'preact';
import { jsonGameDataSource } from '@lml/data';
import { createEngine } from '@lml/engine';
import { App } from './app';
import { parseAutostart } from './autostart';
import { createStore, junglerStartCamps } from './store';

// Composition root: the only module that picks the data source and engine implementations.
const store = createStore(jsonGameDataSource.load(), createEngine());

// Shortcut (any build): ?autostart=1&rank=gold&seed=42 (&jungle=gromp-blue) skips the start screen.
const autostart = parseAutostart(location.search, store.data.aiProfiles.map((p) => p.rank), undefined, junglerStartCamps(store.data));
if (autostart) store.start({ ...autostart, teaching: true });

const root = document.getElementById('app');
if (root) render(<App store={store} />, root);
