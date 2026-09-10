// The contract primitives: how a route is DECLARED, and how a browser CALLS one.
//
// CLIENT-SAFE BY CONSTRUCTION. This module imports `zod` and nothing else - no Fastify, no
// node builtins, no database. Every `features/*/contract.ts` is built on it and the
// application imports those files directly, so anything else added here lands in the browser
// bundle. The server half - mounting these routes - lives next door in `api.ts`, which the
// browser never sees.
//
// This is what replaced the framework's own contract layer. It is small on purpose: three
// builders, one `defineContract`, one `createClient`, and the types that make a call site
// fully inferred. A route and its handler cannot drift, because both are derived from the
// same declaration.
import type { ZodType } from 'zod';

export type Method = 'GET' | 'POST' | 'DELETE';

/**
 * One route: where it lives, and the shapes it speaks. The three schemas are what the
 * server validates at the boundary and what the client checks BEFORE the wire.
 */
export interface Route<Input = undefined, Query = undefined, Output = undefined>
{
    method: Method;
    path: string;
    input?: ZodType<Input>;
    query?: ZodType<Query>;
    output?: ZodType<Output>;
}

/**
 * The permissive shape a contract's values are constrained to. It deliberately says
 * `unknown` for the schemas: the concrete `Route<I, Q, O>` is what carries the types, and
 * the extractors below read them from ITS generic parameters. A stricter constraint here
 * would reject the very routes it exists to describe.
 */
export interface AnyRoute
{
    method: Method;
    path: string;
    input?: unknown;
    query?: unknown;
    output?: unknown;
}

export type ContractShape = Record<string, Record<string, AnyRoute>>;

/** A GET: no body, optionally a query string, optionally an answer. */
export function get<Query = undefined, Output = undefined>(
    path: string,
    options: { query?: ZodType<Query>; output?: ZodType<Output> } = {}
): Route<undefined, Query, Output>
{
    return { method: 'GET', path, query: options.query, output: options.output };
}

/** A POST: a validated body, and an answer only when the route has something to say. */
export function post<Input = undefined, Output = undefined>(
    path: string,
    options: { input?: ZodType<Input>; output?: ZodType<Output> } = {}
): Route<Input, undefined, Output>
{
    return { method: 'POST', path, input: options.input, output: options.output };
}

/**
 * A DELETE. What it acts on rides in the QUERY STRING rather than a body: a DELETE body has
 * no defined semantics in RFC 9110 and intermediaries are free to drop it.
 */
export function del<Query = undefined, Output = undefined>(
    path: string,
    options: { query?: ZodType<Query>; output?: ZodType<Output> } = {}
): Route<undefined, Query, Output>
{
    return { method: 'DELETE', path, query: options.query, output: options.output };
}

/** The whole API in one object. Identity at runtime; the types are the point. */
export function defineContract<C extends ContractShape>(groups: C): C
{
    return groups;
}

// --- Reading a route's shapes back out ---

export type InputOf<R> = R extends Route<infer I, infer _Q, infer _O> ? I : never;
export type QueryOf<R> = R extends Route<infer _I, infer Q, infer _O> ? Q : never;
export type OutputOf<R> = R extends Route<infer _I, infer _Q, infer O> ? O : never;

/** `'pay.start'`, `'admin.overview'` - every route in the contract, as a literal type. */
export type RouteKey<C> = {
    [G in keyof C & string]: `${ G }.${ keyof C[G] & string }`
}[keyof C & string];

/** What one call takes. A route with neither an input nor a query takes nothing at all. */
export type CallArgs<R> =
    (InputOf<R> extends undefined ? object : { input: InputOf<R> })
    & (QueryOf<R> extends undefined ? object : { query: QueryOf<R> });

type NeedsArgs<R> = InputOf<R> extends undefined
    ? (QueryOf<R> extends undefined ? false : true)
    : true;

export type Client<C> = {
    [G in keyof C]: {
        [K in keyof C[G]]: NeedsArgs<C[G][K]> extends true
            ? (args: CallArgs<C[G][K]>) => Promise<OutputOf<C[G][K]>>
            : () => Promise<OutputOf<C[G][K]>>
    }
};

/**
 * A failed call, carrying what the page needs to react: `status` to tell "your session
 * ended" from "something broke", `message` to show the reader, and `fields` so a form can
 * mark the input that was refused.
 */
export class ApiError extends Error
{
    public readonly status: number;
    public readonly code: string;
    public readonly fields: Record<string, string>;

    constructor(status: number, message: string, code = 'error', fields: Record<string, string> = {})
    {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.fields = fields;
    }
}

/** The envelope every failure crosses the wire in. Produced by the server's error handler. */
interface ErrorBody
{
    error?: {
        code?: string;
        message?: string;
        details?: { fields?: Record<string, string> };
    };
}

export interface ClientOptions
{
    /** Prefixed to every path. `/api` in this app, matching the server's mount. */
    baseUrl: string;

    /** Injected so a test can drive the client without a network. */
    fetch?: typeof globalThis.fetch;
}

/**
 * Builds the typed client from a contract.
 *
 * The input schema runs HERE, before anything is sent: a malformed call fails at the call
 * site with the same field map the server would have produced, rather than costing a round
 * trip. The response is NOT re-validated - the server owns its own output, and paying to
 * parse every row twice buys nothing the type system has not already promised.
 */
export function createClient<C extends ContractShape>(contract: C, options: ClientOptions): Client<C>
{
    const call = options.fetch ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
    const client: Record<string, Record<string, unknown>> = {};

    for (const [group, routes] of Object.entries(contract))
    {
        client[group] = {};
        for (const [name, route] of Object.entries(routes))
        {
            client[group][name] = async (args: { input?: unknown; query?: unknown } = {}): Promise<unknown> =>
            {
                const declared = route as Route<unknown, unknown, unknown>;
                let path = `${ options.baseUrl }${ declared.path }`;

                if (declared.query !== undefined)
                {
                    const parsed = declared.query.safeParse(args.query ?? {});
                    if (!parsed.success)
                    {
                        throw new ApiError(422, 'درخواست نامعتبر است', 'validation', fieldsOf(parsed.error.issues));
                    }
                    const search = new URLSearchParams();
                    for (const [key, value] of Object.entries(parsed.data as Record<string, unknown>))
                    {
                        // An absent filter is absent from the URL rather than sent empty:
                        // `?state=` is a value the server would have to special-case.
                        if (value !== undefined && value !== null && value !== '')
                        {
                            search.set(key, String(value));
                        }
                    }
                    const query = search.toString();
                    path += query === '' ? '' : `?${ query }`;
                }

                const init: RequestInit = { method: declared.method, credentials: 'same-origin' };
                if (declared.input !== undefined)
                {
                    const parsed = declared.input.safeParse(args.input);
                    if (!parsed.success)
                    {
                        throw new ApiError(422, 'درخواست نامعتبر است', 'validation', fieldsOf(parsed.error.issues));
                    }
                    init.headers = { 'content-type': 'application/json' };
                    init.body = JSON.stringify(parsed.data);
                }

                const response = await call(path, init);
                if (!response.ok)
                {
                    throw await toError(response);
                }
                if (response.status === 204)
                {
                    return undefined;
                }
                return await response.json() as unknown;
            };
        }
    }

    return client as Client<C>;
}

/** @internal One message per field, keyed the way a form indexes its inputs. */
function fieldsOf(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): Record<string, string>
{
    const fields: Record<string, string> = {};
    for (const issue of issues)
    {
        const key = issue.path.map(String).join('.');
        fields[key === '' ? '_' : key] = issue.message;
    }
    return fields;
}

/** @internal Turns a failed response into the error the page reads, body or no body. */
async function toError(response: Response): Promise<ApiError>
{
    let body: ErrorBody = {};
    try
    {
        body = await response.json() as ErrorBody;
    }
    catch
    {
        // A gateway, a proxy, or a crash can answer with something that is not our
        // envelope. The status is still true, so the error is still useful.
    }
    return new ApiError(
        response.status,
        body.error?.message ?? 'درخواست انجام نشد',
        body.error?.code ?? 'error',
        body.error?.details?.fields ?? {}
    );
}
