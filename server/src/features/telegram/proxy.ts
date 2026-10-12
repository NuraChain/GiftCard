// The road to Telegram that is not the direct one: an HTTP proxy, and the only file that knows
// which library drives it.
//
// WHAT A PROXY SEES. It is asked for a tunnel to the API host (CONNECT) and then carries TLS it
// cannot read. The bot token is inside that TLS, end to end with Telegram. That is the whole
// difference from a relay - a second API host - which has to be handed the token in the URL to
// do its job. `proxyTunnel` keeps it a tunnel even when the API host in the console is a plain
// http:// one, which would otherwise be sent to the proxy as a request it can read.
//
// THE AGENT IS FROM THE `undici` PACKAGE AND THE `fetch` IS NODE'S OWN, which carries its own
// copy of undici. The two only understand each other across the same major version, which is
// why package.json holds this one at Node 24's. And the upload goes on using the global
// FormData for the same reason it uses the global fetch: the two have to come from one place,
// or the multipart body arrives mangled.
import { ProxyAgent } from 'undici';

import { proxyAddress, type TelegramProxy } from '../../contract/shared.ts';
import type { Fetch } from '../checkout/zarinpal.ts';

/** How many agents are kept. The list holds 20; the rest is room for rows being edited. */
const KEPT = 32;

/** One agent per proxy, oldest first, so a connection is reused rather than made per call. */
const agents = new Map<string, ProxyAgent>();

function agentFor(proxy: TelegramProxy): ProxyAgent {
    const key = JSON.stringify(proxy);
    let agent = agents.get(key);
    if (agent === undefined) {
        agent = new ProxyAgent({
            uri: proxyAddress({ ...proxy, username: '' }),
            // As a header rather than in the address, so a password with a `@` or a `/` in it
            // needs no escaping to get there intact.
            token:
                proxy.username === ''
                    ? undefined
                    : `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`,
            proxyTunnel: true
        });
        agents.set(key, agent);

        const [oldest] = agents.keys();
        if (agents.size > KEPT && oldest !== undefined) {
            // A proxy that left the list, or one whose password has since changed. `close`
            // rather than `destroy`: whatever is still in flight through it finishes first.
            void agents.get(oldest)?.close();
            agents.delete(oldest);
        }
    }
    return agent;
}

/** A `fetch` that reaches its host through `proxy`. */
export function throughProxy(proxy: TelegramProxy): Fetch {
    // `dispatcher` is Node's own addition to fetch, which the DOM types this is compiled
    // against have never heard of.
    return (input, init) => fetch(input, { ...init, dispatcher: agentFor(proxy) } as RequestInit);
}
