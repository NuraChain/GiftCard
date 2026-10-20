// The road to Telegram that is not the direct one: an HTTP proxy, and the only file that knows
// which library drives it.
//
// WHAT A PROXY SEES. It is asked for a tunnel to the API host (CONNECT) and then carries TLS it
// cannot read. The bot token is inside that TLS, end to end with Telegram. That is the whole
// difference from a relay - a second API host - which has to be handed the token in the URL to
// do its job. `proxyTunnel` keeps it a tunnel even when the API host in the console is a plain
// http:// one, which would otherwise be sent to the proxy as a request it can read.
//
// AN https:// PROXY HAS TO SHOW A CERTIFICATE THIS MACHINE TRUSTS, like any other TLS host. One
// it signed itself, or one issued for another name, is refused before the login is so much as
// sent - which is why the console says so in words rather than leaving it to look like a
// password that did nothing. See `reasonOf` in ./telegram.ts.
//
// THERE ARE TWO TLS CONNECTIONS ON AN https:// ROAD AND THEY FAIL IN THE SAME WORDS: the one to
// the proxy, and the one inside its tunnel to the API host. Which of them refused a certificate
// is the difference between a proxy that needs a better certificate and a proxy that is
// answering in Telegram's place - and the error itself does not say. `stoppedAtProxy` does.
//
// THE AGENT IS FROM THE `undici` PACKAGE AND THE `fetch` IS NODE'S OWN, which carries its own
// copy of undici. The two only understand each other across the same major version, which is
// why package.json holds this one at Node 24's. And the upload goes on using the global
// FormData for the same reason it uses the global fetch: the two have to come from one place,
// or the multipart body arrives mangled.
import { Pool, ProxyAgent, type buildConnector } from 'undici';

import { proxyAddress, type TelegramProxy } from '../../contract/shared.ts';
import type { Fetch } from '../checkout/zarinpal.ts';

/** How many agents are kept. The list holds 20; the rest is room for rows being edited. */
const KEPT = 32;

/** One agent per proxy, oldest first, so a connection is reused rather than made per call. */
const agents = new Map<string, ProxyAgent>();

/** The failures to connect to a proxy itself. Nothing inside a tunnel is ever in here. */
const stopped = new WeakSet<Error>();

/** @internal The connection to the proxy, made as it always was, and remembered if it fails. */
function remembering(connect: buildConnector.connector): buildConnector.connector {
    return (options, callback) => {
        connect(options, (...result) => {
            if (result[0] !== null) {
                stopped.add(result[0]);
            }
            callback(...result);
        });
    };
}

/**
 * Whether a request that failed got no further than the proxy itself - its address, its port,
 * its TLS, its certificate - as opposed to failing inside the tunnel, which is about the API
 * host. False for anything that did not come out of `throughProxy`.
 */
export function stoppedAtProxy(error: unknown): boolean {
    for (let at = error; at instanceof Error; at = at.cause) {
        if (stopped.has(at)) {
            return true;
        }
    }
    return false;
}

function agentFor(proxy: TelegramProxy): ProxyAgent {
    const key = JSON.stringify(proxy);
    let agent = agents.get(key);
    if (agent === undefined) {
        agent = new ProxyAgent({
            uri: proxyAddress({ ...proxy, username: '' }),
            // As a header rather than in the address, so a password with a `@` or a `/` in it
            // needs no escaping to get there intact. Sent when EITHER box was filled in: a
            // password typed without a name is still a password somebody meant to be used.
            token:
                proxy.username === '' && proxy.password === ''
                    ? undefined
                    : `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`,
            proxyTunnel: true,
            // The agent's own choice of client for the proxy, and its own way of connecting.
            clientFactory: (origin, options: Pool.Options) =>
                new Pool(origin, {
                    ...options,
                    connect: remembering(options.connect as buildConnector.connector)
                })
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
