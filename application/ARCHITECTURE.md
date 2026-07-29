# How the front end is laid out

Four layers. A file belongs to the layer whose question it answers, and a layer may only
reach DOWNWARDS - a primitive that imports a page, or a page that imports another page's
internals, is the mistake this layout exists to make visible.

```
src/
  main.azeroth      Mounts the app. Client entry.
  entry.server.ts   The same routes, rendered on the server.
  routes.ts         The one route table. Both entries read it; there is no second manifest.
  App.azeroth       The frame every page renders inside: skip link, navbar, footer, toasts.
  styles.css        Tokens, the type and spacing scale, and the few rules Tailwind cannot
                    express as utilities (`.table-cards`, the scrollbar, the tap shapes).

  pages/            One file per route. Fetches what it needs, owns its own state.
    landing.azeroth The shop.
    admin/          The console: shell + four tabs + the session store.

  components/       Composites that know about THIS shop.
    purchase-panel  Phone, confirm, pay, receipt.
    code-capsule    The gift code as the page's hero motif.
    gift-card, faq-item, mobile-nav, theme-toggle, toast-host, async

    ui/             Primitives that know nothing about gift cards. If it mentions a code,
                    a price or an order, it does not belong here.
      button        Every button. Variants are NAMES for decisions, not class strings.
      text-input    Every text field, and the `latin` rule for Latin-in-Persian runs.
      field         Label + control + hint/error, with the for/id binding built in.
      select        A picker the design owns - see the note at the top of the file for
                    why this is not a `<select>`.

  api.ts            The typed client, built from the server's contract. One declaration,
                    both sides.
  catalog.ts        The catalogue + shop name, as a store. Any page can read it.
  format.ts         Persian numerals, money, dates. Formatting lives here, not in markup.
  content.ts        Copy that is not in the database: steps, FAQ, contact.
```

## The rules that are easy to break

**A `ui/` primitive never imports from `pages/`, `api.ts`, or `catalog.ts`.** It takes props
and returns markup. That is what makes it reusable and what keeps it testable without a
server.

**Formatting goes through `format.ts`.** A bare `{ count }` in markup renders Latin digits
into a Persian sentence.

**A Latin run carries its own direction.** `dir="ltr"` plus the `latin` class, or through
`TextInput latin` / `SelectOption.latin`. Without it, bidi reorders the Persian around it.

**The spacing and type scales are tokens, not numbers.** `py-section`, `text-small`,
`min-h-tap`. A hardcoded `2.75rem` is the same decision written a second time, and the two
copies will disagree.
