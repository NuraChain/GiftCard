# How the server is laid out

Five layers, each answering one question. A file belongs to the layer whose question it
answers, not to the feature it happens to serve.

```
src/
  main.ts        Bootstrap. The ONLY file that reads the environment or builds a real
                 gateway, SMS client or database.
  app.ts         Route wiring. Says which handler serves which route and which are
                 guarded, and nothing else.
  config.ts      The environment - as a SEED, not the last word (see services/settings.ts).
  contract.ts    The shared wire contract. Client-safe: the browser imports this file.

  routes/        HTTP. Reads a request, calls a service or the store, shapes a response.
    pay.ts       The shop, the checkout, the bank's return, the receipt.
    admin.ts     The console: session, ledger, inventory, catalogue, settings, key.
    throttle.ts  Per-route rate limiting.

  services/      Rules. No HTTP types cross this line.
    checkout.ts  THE MONEY RULES. Read this before touching a payment.
    admin.ts     Sessions, lockout, cookies.
    settings.ts  Runtime configuration: the write-only rule, the audit, the admin key.

  gateways/      Third parties, behind an injectable `fetch`.
    zarinpal.ts  Payment request and verify.
    kavenegar.ts SMS delivery.

  db/            Persistence. One module per table; SQL lives here and nowhere else.
    index.ts     Opens the database and composes the modules into one `Store`.
    schema.ts    Every table and index, in one readable place.
    types.ts     The shapes the database speaks, and the `Store` interface.
    orders.ts    The ledger, and the transactions that move a purchase through its life.
    codes.ts     The inventory, and the claim that stops two buyers getting one code.
    tiers.ts     The catalogue.
    settings.ts  Settings rows and the audit beside them.
    shared.ts    Row casts and the phone-search helper.

  domain/        Pure rules, no I/O.
    phone.ts     Iranian mobile numbers, normalised to one canonical form.
    codes.ts     The receipt token. Gift codes are inventory, never minted here.
    seed.ts      The catalogue a first boot starts from.
```

## The rules that decide where something goes

**A route may not contain a rule that matters.** `settle` used to live inside the route
wiring, which meant the four rules that decide whether money moved could only be found by
reading past a router. It is `services/checkout.ts` now, and the header of that file states
them.

**SQL lives in `db/` only.** A route that builds a query has put the schema in two places.

**A cross-table transaction belongs to its aggregate, not to a table.** Claiming a code and
creating the order it belongs to is one indivisible act, so it lives in `db/orders.ts` and
calls into `db/codes.ts` - the transaction is the unit, not the table.

**`services/` never imports from `routes/`.** If a service needs to answer with a status
code, it is returning a result the route translates, not throwing HTTP from underneath.

**Handler factories are typed FROM the contract** (`HandlersWithGuards<typeof contract, …>`),
so a route added without a handler - or a handler whose shape drifts - is a compile error
rather than a runtime 500.

## Where to start reading

- Money: `services/checkout.ts`, then `routes/pay.ts`.
- Never selling one code twice: `db/codes.ts`, the `claim` statement.
- Credentials: `services/settings.ts`.
- The API's shape: `contract.ts`, then `app.ts`.
