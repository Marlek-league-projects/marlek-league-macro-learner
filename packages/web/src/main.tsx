import { render } from 'preact';
import { jsonGameDataSource } from '@lml/data';
import { createEngine } from '@lml/engine';
import { App } from './app';
import { createStore } from './store';

// Composition root: the only module that picks the data source and engine implementations.
const store = createStore(jsonGameDataSource.load(), createEngine());

const root = document.getElementById('app');
if (root) render(<App store={store} />, root);
