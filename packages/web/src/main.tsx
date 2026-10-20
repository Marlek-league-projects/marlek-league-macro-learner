import { render } from 'preact';
import { jsonGameDataSource } from '@lml/data';
import { createEngine } from '@lml/engine';
import { App } from './app';
import { createStore, type Settings } from './store';

// Composition root: the only module that picks the data source and engine implementations.
const store = createStore(jsonGameDataSource.load(), createEngine());

// Dev shortcut for screenshots: ?autostart=1&rank=gold&seed=42 skips the start screen.
const params = new URLSearchParams(location.search);
if (params.get('autostart') === '1') {
  const rank = (params.get('rank') ?? 'gold') as Settings['rank'];
  store.start({ rank, teaching: true, seed: Number(params.get('seed') ?? 42) });
}

const root = document.getElementById('app');
if (root) render(<App store={store} />, root);
