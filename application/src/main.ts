// The client entry: mount the app into the shell nginx served.
//
// There is no hydration step. nginx serves one static shell for every path, so the first
// thing that happens in the document is this.
import { render } from 'azerothjs';

import App from './App.azeroth';
import { settleFirstVisit } from './lib/first-visit.ts';

const root = document.getElementById('root');
if (root === null) {
    throw new Error('index.html is missing its #root element');
}

// The language is settled BEFORE the first render, so a first arrival at `/` starts on its
// own language's page instead of painting the Persian one and then jumping.
void settleFirstVisit().finally(() => render(() => App({}), root));
