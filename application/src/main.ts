// The client entry: mount the app into the shell nginx served.
//
// There is no hydration step. nginx serves one static shell for every path, so the first
// thing that happens in the document is this.
import { render } from 'azerothjs';

import App from './App.azeroth';

const root = document.getElementById('root');
if (root === null) {
    throw new Error('index.html is missing its #root element');
}

render(() => App({}), root);
