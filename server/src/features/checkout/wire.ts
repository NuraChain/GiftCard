// The one POST both gateway clients make - and, when it goes wrong, enough said about HOW for
// the log line to be acted on.
//
// A gateway that will not open a payment is the shop being closed, and "request failed" does
// not tell the operator whether to fix a merchant id, top up a wallet, or call their host. So
// nothing is collapsed into "no answer" here: the transport's own error, the status line, and
// the first words of a body that was not JSON are all kept.
//
// ONLY THE GATEWAY'S SIDE IS EVER REPEATED. The request carries the merchant id and is never
// echoed. A parsed body is never quoted whole either: a success carries the payment's handle,
// and the logger redacts that by KEY - it cannot find one inside a sentence. So a client picks
// the fields worth repeating (a code, a message) and everything it repeats goes through `quote`.
import type { Fetch } from './zarinpal.ts';

/** How much of somebody else's words one log line will carry. */
const QUOTE_LIMIT = 200;

/** One bounded line: whitespace collapsed, cut at the limit. */
export function quote(raw: string): string {
    const flat = raw.replaceAll(/\s+/g, ' ').trim();
    return flat.length > QUOTE_LIMIT ? `${flat.slice(0, QUOTE_LIMIT)}...` : flat;
}

/** What came back from one POST. */
export interface Answer<Body> {
    /** The parsed JSON object, or null when there was none to parse. */
    body: Body | null;

    /** The status line, or null when the gateway was never reached. */
    status: number | null;

    /** Why `body` is null, in words for a log. Empty when it is not. */
    trouble: string;
}

/**
 * @internal A thrown error as one line.
 *
 * fetch reports every socket failure as `TypeError: fetch failed`. WHICH one it was - a name
 * that does not resolve, a reset, a certificate - is only on `cause`, so that is read too.
 */
function thrown(error: unknown): string {
    if (!(error instanceof Error)) {
        return quote(String(error));
    }
    const said = [`${error.name}: ${error.message}`];
    const { cause } = error;
    if (cause instanceof Error) {
        const code = (cause as { code?: unknown }).code;
        said.push(typeof code === 'string' ? `${code}: ${cause.message}` : cause.message);
    }
    return quote(said.join(' - '));
}

/**
 * Posts JSON and reads JSON back, under a timeout. NEVER THROWS: a gateway that cannot be
 * reached is an answer the caller has to act on, not an exception for the buyer's request.
 *
 * The body is read whatever the status was - both gateways report a refusal in the body, and
 * one of them does it under a 4xx.
 */
export async function postJson<Body>(
    call: Fetch,
    url: string,
    body: Record<string, unknown>,
    timeoutMs: number
): Promise<Answer<Body>> {
    let response: Response;
    let text: string;
    try {
        response = await call(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs)
        });
        text = await response.text();
    } catch (error) {
        // Never reached, cut off mid-answer, or timed out: the error says which.
        return { body: null, status: null, trouble: `no answer: ${thrown(error)}` };
    }

    const { status } = response;
    try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
            return { body: parsed as Body, status, trouble: '' };
        }
    } catch {
        // Falls through: a body that does not parse is reported exactly as one that parsed
        // into something that is not an object.
    }
    // An HTML page where JSON was expected is a proxy, a firewall or a block page talking, and
    // its first words usually say which.
    return { body: null, status, trouble: `http ${status}, not JSON: ${quote(text)}` };
}

/**
 * Why a gateway said no, for the inside of a `(...)` in a reason: its code and its own
 * message when it gave them, and the status line when that was not a plain 2xx.
 *
 * `code` and `message` are whatever the client found in the body - both gateways keep them in
 * different places - and are checked here rather than trusted: it is somebody else's JSON.
 */
export function refusal(answer: Answer<unknown>, code: unknown, message: unknown): string {
    if (answer.body === null) {
        return answer.trouble;
    }
    const named = typeof code === 'number' || (typeof code === 'string' && code !== '');
    const said = [`code ${named ? quote(String(code)) : 'none'}`];
    if (typeof message === 'string' && message.trim() !== '') {
        said[0] += `: ${quote(message)}`;
    }
    const { status } = answer;
    if (status !== null && (status < 200 || status > 299)) {
        said.push(`http ${status}`);
    }
    return said.join('; ');
}
