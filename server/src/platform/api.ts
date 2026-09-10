// Mounting a contract onto Fastify. SERVER ONLY - the browser never imports this file.
//
// `mountApi` is the seam that keeps a route and its handler from drifting: the handlers
// object is typed FROM the contract, so a handler whose shape no longer matches its route
// fails to compile, and a feature that forgets a route fails to compile too. That property
// is the reason this file exists rather than thirty hand-written `app.post(...)` calls.
//
// Validation happens HERE, at the boundary, from the same schema the browser checked before
// sending - so a forged request gets the 422 whose field map the form displays.
//
// GUARDS RUN BEFORE VALIDATION, deliberately. An unauthenticated request to a console route
// must be answered 401, not handed a 422 that tells an anonymous caller which fields the
// route expects; and a throttle that only fired on well-formed requests would be trivially
// side-stepped by sending malformed ones.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import type { ContractShape, InputOf, OutputOf, QueryOf, Route, RouteKey } from './contract.ts';
import { ValidationError } from './http.ts';

/** What a handler is given. `reply` is here for the few routes that set a cookie or a status. */
export interface HandlerContext<Input, Query> {
    input: Input;
    query: Query;
    request: FastifyRequest;
    reply: FastifyReply;
}

/**
 * What a handler must return. A route that declared an `output` must produce one; a route
 * that declared none must produce nothing, and answers 204. Wrapped in a tuple so the
 * conditional does not distribute over a union output.
 */
type HandlerResult<O> = [O] extends [undefined] ? void | Promise<void> : O | Promise<O>;

/** One handler, typed from the route it implements. */
export type Handler<R> = (
    context: HandlerContext<InputOf<R>, QueryOf<R>>
) => HandlerResult<OutputOf<R>>;

/**
 * Every handler in the contract. A feature exports a `Pick<>` of one group's keys, so its
 * own file is where a drifted handler is reported - and `mountApi` still proves the union
 * covers every route.
 */
export type Handlers<C> = {
    [G in keyof C]: { [K in keyof C[G]]: Handler<C[G][K]> };
};

/** A check that runs before the handler and throws to refuse. */
export type Guard = (context: {
    request: FastifyRequest;
    reply: FastifyReply;
}) => void | Promise<void>;

/** Identity, for readability at the call site: `guards: { 'pay.start': [guard(throttle(8, 60_000))] }`. */
export function guard(check: Guard): Guard {
    return check;
}

export interface MountOptions<C> {
    /** Prefixed to every route's path. `/api` in this app. */
    prefix?: string;

    /** Per-route, keyed `'group.route'`. An unknown key is a compile error. */
    guards?: Partial<Record<RouteKey<C>, Guard[]>>;

    handlers: Handlers<C>;
}

/** @internal The boundary check. A failure becomes the 422 the form can display. */
function parse<T>(schema: ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (result.success) {
        return result.data;
    }
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
        const key = issue.path.map(String).join('.');
        fields[key === '' ? '_' : key] = issue.message;
    }
    throw new ValidationError(fields);
}

type LooseHandler = (context: HandlerContext<unknown, unknown>) => unknown;

export function mountApi<C extends ContractShape>(
    app: FastifyInstance,
    contract: C,
    options: MountOptions<C>
): void {
    const prefix = options.prefix ?? '';
    const guards = (options.guards ?? {}) as Record<string, Guard[] | undefined>;
    const handlers = options.handlers as unknown as Record<string, Record<string, LooseHandler>>;

    for (const [group, routes] of Object.entries(contract)) {
        for (const [name, route] of Object.entries(routes)) {
            const declared = route as Route<unknown, unknown, unknown>;
            const handler = handlers[group][name];
            const checks = guards[`${group}.${name}`] ?? [];

            app.route({
                method: declared.method,
                url: `${prefix}${declared.path}`,
                handler: async (request, reply) => {
                    for (const check of checks) {
                        await check({ request, reply });
                    }

                    const input =
                        declared.input === undefined
                            ? undefined
                            : parse(declared.input, request.body);
                    const query =
                        declared.query === undefined
                            ? undefined
                            : parse(declared.query, request.query);

                    const result = await handler({ input, query, request, reply });

                    // A route with nothing to say answers 204 rather than `null`. The
                    // handler may already have chosen a status (or set a cookie); this only
                    // fills in the default.
                    if (declared.output === undefined) {
                        if (reply.statusCode === 200) {
                            reply.code(204);
                        }
                        return reply.send();
                    }
                    return reply.send(result);
                }
            });
        }
    }
}
