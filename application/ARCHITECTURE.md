# How the front end is laid out

Four layers, and each may only reach DOWNWARDS. A `ui/` primitive that imports a page, or a
page that reaches into another page's internals, is the mistake this layout exists to make
visible.

```
src/
  main.azeroth      Mounts the app. Client entry.
  entry.server.ts   The same routes, rendered on the server.
  routes.ts         The one route table. Both entries read it; there is no second manifest.
  App.azeroth       The frame every page renders inside: skip link, navbar, footer, toasts.
  styles.css        Tokens, the type and spacing scale, and the few rules Tailwind cannot
                    express as utilities (`.table-cards`, the scrollbar, the tap shapes).

  lib/              What the app knows, with no markup attached.
    api.ts          The typed client, built from the server's contract. One declaration,
                    both sides.
    catalog.ts      The catalogue + shop name, as a store. Any page can read it.
    format.ts       Persian numerals, money, dates. Formatting lives here, not in markup.
    content.ts      Copy that is not in the database: steps, FAQ, contact.

  ui/               Primitives that know nothing about gift cards. If it mentions a code,
                    a price or an order, it does not belong here.
    button          Every button. Variants are NAMES for decisions, not class strings.
    text-input      Every text field, and the `latin` rule for Latin-in-Persian runs.
    field           Label + control + hint/error, with the for/id binding built in.
    select          A picker the design owns - see the note at the top of the file for
                    why this is not a `<select>`.
    async           The four states of a fetch: loading, error+retry, empty, content.
    icon.ts         Lucide icons built through `h()` so they survive SSR.
    toast.ts        The notice store.
    toast-host      Where notices are drawn.

  components/       Composites that know about THIS shop.
    purchase-panel  Phone, confirm, pay, receipt.
    code-capsule    The gift code as the page's hero motif.
    gift-card, faq-item, mobile-nav, theme-toggle

  pages/            One folder or file per route.
    landing.azeroth
    admin/
      shell.azeroth     the console frame: the lock screen, the tabs, sign-out
      session.ts        the console session, shared by every tab
      overview.azeroth
      orders.azeroth
      codes/            index + paste-form + inventory-table
      settings/         index + tiers + gateway + admin-key
```

## Why two admin pages are folders

`settings.azeroth` was 585 lines doing three unrelated jobs, and `codes.azeroth` was 437
doing two. They are folders now: one component per job, and an `index.azeroth` that owns only
what the siblings genuinely share.

- **`settings/`** shares nothing. Each component loads and saves independently, so one
  failing to load does not blank the other two. `index.azeroth` is nine lines.
- **`codes/`** shares two things, and the parent owns both: the catalogue (the paste form's
  picker and the table's amount filter both need it) and a `revision` counter the form bumps
  after a paste so the table refetches. Neither child knows the other exists.

That second pattern is the one to copy when a page needs siblings to react to each other: a
number the parent owns and a child watches with `effect`, not a shared store and not a
reference between components.

## The rules that are easy to break

**A `ui/` primitive never imports from `pages/`, `lib/api.ts`, or `lib/catalog.ts`.** It takes
props and returns markup. That is what makes it reusable and what keeps it testable without a
server.

**Formatting goes through `lib/format.ts`.** A bare `{ count }` in markup renders Latin digits
into a Persian sentence.

**A Latin run carries its own direction.** `dir="ltr"` plus the `latin` class, or through
`TextInput latin` / `SelectOption.latin`. Without it, bidi reorders the Persian around it.

**The spacing and type scales are tokens, not numbers.** `py-section`, `text-small`,
`min-h-tap`. A hardcoded `2.75rem` is the same decision written a second time, and the two
copies will disagree.

**A page component fetches; a child component renders.** When a page grows past ~300 lines it
is usually doing two jobs - split it the way `codes/` and `settings/` are split rather than
adding another state flag.
