# How the server is laid out

**Organised by FEATURE, not by layer.** A feature is a folder you can read top to bottom: its
wire shapes, its handlers, its rules and its SQL sit together. "How does buying a card work?"
has one answer - open `features/checkout/`.

It used to be layer-first (`routes/`, `services/`, `db/`, `gateways/`, `contract/`). Every
file was fine and following one feature still meant opening eight of them across five
directories. That is the trade this layout reverses.

**This process serves JSON and nothing else.** nginx serves the built client and terminates
TLS (`deploy/nginx.conf`), so there is no page rendering here, no static file serving, no
HSTS header and no CORS layer - the browser only ever talks to one origin.

```
src/
  main.ts        Bootstrap. The ONLY file that reads the environment or builds a real
                 gateway, SMS client or database.
  app.ts         WIRING ONLY: which feature answers which group, which routes are guarded,
                 and how a thrown failure becomes a response. If a rule appears here, it is
                 in the wrong file.
  config.ts      The environment - as a SEED, not the last word (see features/settings).

  platform/      What every feature needs and none of them owns.
    contract.ts  CLIENT-SAFE. Route builders, defineContract, and the typed client the
                 browser imports. Depends on zod and nothing else.
    api.ts       SERVER ONLY. mountApi: registers a contract onto Fastify, validates at the
                 boundary, and types the handlers FROM the contract.
    http.ts      The failures a handler may throw, and the one envelope they cross in.
    logging.ts   The three-method logger port the features depend on.
    env.ts       Reading the environment once, reporting every problem at once.
    db.ts        Opens the connection, sets the pragmas, applies the schema.
    schema.ts    EVERY table and index, in one readable map.
    throttle.ts  Per-route rate limiting, and where the client's address comes from.

  contract/
    index.ts     defineContract({ pay, admin }) - the whole API in one screen.
    shared.ts    The two amount fields both halves need.

  features/
    checkout/    A buyer buys a card.
      contract.ts  the shop's wire shapes and routes
      routes.ts    handlers, plus the gateway's redirect callback
      checkout.ts  THE MONEY RULES. Read this before touching a payment.
      queries.ts   the ledger, and the transactions that move a purchase along
      zarinpal.ts  payment request and verify
      sms.ts       code delivery

    inventory/   Codes come in, codes go out.
      contract.ts  routes.ts  queries.ts (the claim that stops double-selling)

    catalogue/   What the shop sells.
      contract.ts  routes.ts  queries.ts (a used tier deactivates, never deletes)

    console/     Who is signed in, and what happened.
      contract.ts  routes.ts  session.ts (sessions, lockout, cookies)

    settings/    Runtime configuration, and the admin key.
      contract.ts  routes.ts  settings.ts (the write-only rule)  queries.ts

  db/            The Store composition and the vocabulary every query module speaks.
    index.ts     Assembles each feature's queries into one injectable Store.
    types.ts     The shapes the database speaks, and the Store interface.
    shared.ts    The order row cast and the phone-search helper.

  domain/        Pure rules, no I/O.
    phone.ts     Iranian mobile numbers, normalised to one canonical form.
    codes.ts     The receipt token. Gift codes are inventory, never minted here.
    seed.ts      The catalogue a first boot starts from.
```

## The rules that keep it honest

**A feature folder reads top to bottom.** Opening `features/checkout/` answers "how does
buying work" without another directory.

**The schema stays central.** `platform/schema.ts` holds every `CREATE TABLE` - a database's
shape is one thing, and scattering it per feature loses the map. Only the *queries* live in
features.

**A feature may import another feature's queries, never its routes.** Checkout claims a code
and settles an order in one transaction, so `features/checkout/queries.ts` legitimately reads
`features/inventory/queries.ts`. If two features needed each other's *routes*, they would be
one feature.

**Every `features/*/contract.ts` is CLIENT-SAFE.** It may import `platform/contract.ts`, `zod`,
`domain/` and `contract/shared.ts` - nothing else. The application imports these files
directly, so anything else here lands in the browser bundle. `platform/api.ts` is the server
half and is deliberately a separate module for exactly that reason.

**Contract groups are the client's call path, not the folder name.** The wire has two groups,
`pay` and `admin`; `contract/index.ts` composes each feature's declarations into them. A
feature can move without changing a line of browser code.

**Each feature claims only its own routes.** A handler factory returns
`Pick<Handlers<typeof contract>['admin'], 'its' | 'own' | 'keys'>`, so a handler whose shape
drifts from its route fails to compile in its own file - and `mountApi` in `app.ts` still
proves the union covers every route in the contract.

**A route may not contain a rule that matters.** The four rules that decide whether money
moved are stated in the header of `features/checkout/checkout.ts`, not buried in a router.

**SQL lives in a `queries.ts` only.** A route that builds a query has put the schema in two
places.

**A handler throws; it does not build an error response.** `platform/http.ts` names the
failures and `app.ts` has the one handler that turns them into statuses. That is what keeps
the envelope uniform enough for the browser to parse a failure without knowing the route.

## Being behind nginx

The proxy is not a deployment detail the code can ignore, because two things depend on it:

- **The client's address.** `request.ip` is only the buyer's if `TRUST_PROXY_HOPS` matches
  the number of proxies AND nginx overwrites `X-Forwarded-For` rather than appending to it.
  Every per-IP throttle and the console's sign-in lockout rest on that pair; the long note in
  `platform/throttle.ts` explains what each half prevents.
- **The `Secure` cookie flag.** nginx terminates TLS, so this process sees plain http even
  when the browser is on https. `COOKIE_SECURE` is therefore configured, not sensed.

## Why the Store is still one object

Each feature owns its queries, but `db/index.ts` composes them into a single `Store` that
`buildApp` takes as one argument. That is deliberate: it is why a test can drive the entire
app - the forged-callback, replay and sold-out paths included - against `:memory:` with two
fakes and no network. Splitting it into five injected query objects would buy symmetry and
cost the thing that makes the suite worth having.

## Where to start reading

- **Money**: `features/checkout/checkout.ts`, then its `routes.ts`.
- **Never selling one code twice**: `features/inventory/queries.ts`, the `claim` statement.
- **Credentials**: `features/settings/settings.ts`.
- **The API's shape**: `contract/index.ts`, then `app.ts`.

## Testing

`app.inject({ method, url, payload })` is the whole story: no sockets, no test server. The
gateway and the SMS provider are injected fakes; the database is a real SQLite in memory, so
every claim about money is tested against the engine that ships.

**What the suite does not cover, and why it matters:** `buildApp` is what the tests drive, so
anything wired in `main.ts` - the edge rate limiter, the logger, the listen call - is outside
it. That gap has already cost one bug: a synchronous Fastify `onRequest` hook that never
called `done`, which accepted requests and then hung them forever. Exercise a real boot after
touching `main.ts`.
