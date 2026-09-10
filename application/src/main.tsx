// The client entry: mount the app into the shell nginx served.
//
// There is no hydration step any more. The old build shipped a server-rendered shop that the
// browser adopted in place; nginx serves one static shell for every path now, so the first
// thing that happens in the document is this.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';

const root = document.getElementById('root');
if (root === null) {
    throw new Error('index.html is missing its #root element');
}

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>
);
