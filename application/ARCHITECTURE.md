# How the front end is laid out

Four layers, and each may only reach DOWNWARDS. A `ui/` primitive that imports a page, or a
page that reaches into another page's internals, is the mistake this layout exists to make
visible.

```
src/
  main.tsx          Mounts the app into the shell nginx served. No hydration step - every
                    page is rendered in the browser.
  routes.tsx        The one route table. The router reads it; there is no second manifest.
  App.tsx           The providers, the router, and the frame every page renders inside:
                    skip link, navbar, footer, toasts.
  styles.css        Tokens, the type and spacing scale, and the few rules Tailwind cannot
                    express as utilities (`.table-cards`, the scrollbar, the tap shapes).

  lib/              What the app knows, with no markup attached.
    api.ts          The typed client, built from the server's contract. One declaration,
                    both sides.
    catalog.tsx     The catalogue + shop name, as a context. Any page can read it.
    format.ts       Persian numerals, money, dates. Formatting lives here, not in markup.
    content.ts      Copy that is not in the database: steps, FAQ, contact.
    use-form.ts     A form validated by the SAME schema the server enforces.

  ui/               Primitives that know nothing about gift cards. If it mentions a code,
                    a price or an order, it does not belong here.
    button          Every button. Variants are NAMES for decisions, not class strings.
    text-input      Every text field, and the `latin` rule for Latin-in-Persian runs.
    field           Label + control + hint/error, with the htmlFor/id binding built in.
    select          A picker the design owns - see the note at the top of the file for
                    why this is not a `<select>`.
    async           The four states of a fetch: loading, error+retry, empty, content.
    toast.tsx       The notice store, as a context.
    toast-host      Where notices are drawn.

  components/       Composites that know about THIS shop.
    gift-card       One tier, AND the purchase for it: phone, confirm, pay.
    purchase-result The outcome the buyer comes back from the bank to.
    code-capsule    The gift code as the page's hero motif.
    faq-item, mobile-nav, theme-toggle

  pages/            One folder or file per route.
    landing.tsx
    admin/
      shell.tsx         the console frame: the lock screen, the tabs, sign-out
      session.tsx       the console session, shared by every tab
      overview.tsx
      orders.tsx
      codes/            index + paste-form + inventory-table
      settings/         index + tiers + gateway + admin-key
```

## Where the purchase lives

Each **card** carries its own phone input, confirm step and pay button. The shop used to have
one form at the foot of the page and a "choose" button on every card that scrolled down to
it; the buyer now types their number on the card they are buying, so the amount is never a
separate choice that can drift out of step with what they are looking at.

`purchase-result.tsx` is what could not move, because the buyer arrives at it from the
GATEWAY rather than from a click, carrying a token in the URL. It renders nothing at all when
there is no token, so an ordinary visit does not carry an empty panel around.

The **confirm step survived that move** and is not decoration: the phone number is the only
way the code reaches the buyer, and a mistyped digit is discovered after the money has moved.

## Why two admin pages are folders

`settings.tsx` would be 585 lines doing three unrelated jobs, and `codes.tsx` 437 doing two.
They are folders: one component per job, and an `index.tsx` that owns only what the siblings
genuinely share.

- **`settings/`** shares nothing. Each component loads and saves independently, so one
  failing to load does not blank the other two.
- **`codes/`** shares two things, and the parent owns both: the catalogue (the paste form's
  picker and the table's amount filter both need it) and a `revision` counter the form bumps
  after a paste so the table refetches. Neither child knows the other exists.

That second pattern is the one to copy when a page needs siblings to react to each other: a
number the parent owns and a child watches in an effect, not a shared context and not a ref
between components.

## The rules that are easy to break

**A `ui/` primitive never imports from `pages/`, `lib/api.ts`, or `lib/catalog.tsx`.** It
takes props and returns markup. That is what makes it reusable and what keeps it testable
without a server.

**Formatting goes through `lib/format.ts`.** A bare `{ count }` in markup renders Latin digits
into a Persian sentence.

**A Latin run carries its own direction.** `dir="ltr"` plus the `latin` class, or through
`TextInput latin` / `SelectOption.latin`. Without it, bidi reorders the Persian around it.
There is a test that holds this.

**The spacing and type scales are tokens, not numbers.** `py-section`, `text-small`,
`min-h-tap`. A hardcoded `2.75rem` is the same decision written a second time, and the two
copies will disagree.

**A console tab fetches on the SESSION, not on mount.** A tab is mounted by the route, which
happens before anyone has signed in, so a mount-time fetch 401s against the lock screen and
never retries. Every tab watches `session.revision` instead.

**A page component fetches; a child component renders.** When a page grows past ~300 lines it
is usually doing two jobs - split it the way `codes/` and `settings/` are split rather than
adding another state flag.

## A note on the hook rules

`eslint-plugin-react-hooks` v7 ships the React Compiler's ruleset alongside the two classic
rules. This project takes `rules-of-hooks` and `exhaustive-deps` only, and
`eslint.config.ts` says why: rules like `set-state-in-effect` encode a stricter model than
this app is written to, and adopting them is a decision about how everything here is written
rather than a default. It is a reasonable thing to revisit - it would mostly mean rethinking
how the console tabs load - but it should be revisited deliberately.
