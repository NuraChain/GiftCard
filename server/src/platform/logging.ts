// What the application asks of a logger, and nothing more.
//
// Features depend on THIS interface rather than on pino or on Fastify's logger type. Three
// methods, in pino's `(details, message)` call shape, is the whole surface the rules use -
// and depending on the smallest thing that works is what keeps `features/checkout/checkout.ts`
// honest when it says there is no HTTP in sight.
//
// `main.ts` builds a real pino instance and it satisfies this structurally; a test passes
// nothing at all, which is why every call site writes `log?.`.

export interface Logger
{
    info(details: object, message?: string): void;
    info(message: string): void;

    warn(details: object, message?: string): void;
    warn(message: string): void;

    error(details: object, message?: string): void;
    error(message: string): void;
}
