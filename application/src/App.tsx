// The shell: navbar, the routed page, and the footer.
//
// Layout uses LOGICAL properties throughout (ms/me, ps/pe, start/end). In an RTL document a
// physical `left` is whichever side the design did not mean.
//
// `url` exists for tests, which pin the route through a memory history rather than a real
// address bar. A browser never passes it.
import { Link2, Mail, MessageCircle, Phone, Clock } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, MemoryRouter, Route, Routes, Link } from 'react-router';

import { CatalogProvider, useCatalog } from './lib/catalog.tsx';
import { routes } from './routes.tsx';
import { CONTACT, ENAMAD } from './lib/content.ts';
import { year } from './lib/format.ts';
import ThemeToggle from './components/theme-toggle.tsx';
import MobileNav from './components/mobile-nav.tsx';
import ToastHost from './ui/toast-host.tsx';
import { ToastProvider } from './ui/toast.tsx';
import { AdminSessionProvider } from './pages/admin/session.tsx';

// Absolute, not bare fragments. The bar is shown on every route, and `#cards` from the
// console would navigate to /admin#cards and scroll nowhere - the link has to name the page
// it belongs to as well as the section.
const NAV_LINKS = [
    { href: '/#cards', label: 'کارت‌ها' },
    { href: '/#how', label: 'روش خرید' },
    { href: '/#faq', label: 'سوال‌های پرتکرار' }
];

// `code` is a non-standard attribute (see the seal in the footer). React renders any
// lowercase attribute it does not recognise, but the DOM typings only describe the standard
// ones - so it is spread from here, which says "this one is deliberate" without widening
// what every other <img> in the app is allowed to carry.
const SEAL_CODE: Record<string, string> = { code: ENAMAD.code };

/** The chrome, and the routed page inside it. Split out so it can use the router's hooks. */
function Chrome(): ReactNode {
    // The shop's name is configuration, not a constant: the console can change it and every
    // place it appears - the tab title, this brand, the footer - follows without a deploy.
    const catalog = useCatalog();
    const { loaded, load } = catalog;

    useEffect(() => {
        if (!loaded) {
            void load();
        }
    }, [loaded, load]);

    return (
        <div>
            <a
                href="#main"
                className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-small focus:font-bold"
            >
                پرش به محتوای اصلی
            </a>

            <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur">
                <nav
                    className="relative mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-4 sm:px-5"
                    aria-label="ناوبری اصلی"
                >
                    {/* The brand goes HOME, not to an in-page anchor: `#main` sent the console
                        to /admin#main, which looks broken and leaves the operator stranded. */}
                    <Link to="/" className="flex min-h-tap items-center gap-2 font-bold">
                        <Link2 className="size-6 text-firouze" aria-hidden="true" />
                        {catalog.appName}
                    </Link>

                    <ul className="ms-6 hidden items-center gap-6 text-small text-muted md:flex">
                        {NAV_LINKS.map((link) => (
                            <li key={link.href}>
                                <a
                                    className="flex min-h-tap items-center hover:text-ink"
                                    href={link.href}
                                >
                                    {link.label}
                                </a>
                            </li>
                        ))}
                    </ul>

                    {/* `ms-auto` belongs HERE, not on the link list: the list is hidden on the
                        console and on phones, and the controls would then bunch against the
                        brand instead of staying pinned to the end of the bar. */}
                    <div className="ms-auto flex items-center gap-2">
                        <ThemeToggle />
                        <MobileNav links={NAV_LINKS} />
                    </div>
                </nav>
            </header>

            <main id="main">
                <Routes>
                    {routes.map(({ path, Component }) => (
                        <Route key={path} path={path} element={<Component />} />
                    ))}
                    <Route path="*" element={<p className="p-10 text-center">صفحه پیدا نشد.</p>} />
                </Routes>
            </main>

            <ToastHost />

            {/* The console shares this footer rather than hiding it: it is the same product,
                the support contacts in it are the ones an operator quotes, and one shell is
                one thing to keep right. There is deliberately no link TO the console here -
                an operator types the address, and a public link to a login is an invitation. */}
            <footer className="mt-section border-t border-line">
                <div className="mx-auto grid max-w-6xl gap-stack px-4 py-section sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
                    <div className="sm:col-span-2">
                        <p className="flex items-center gap-2 font-bold">
                            <Link2 className="size-5 text-firouze" aria-hidden="true" />
                            {catalog.appName}
                        </p>
                        <p className="mt-3 max-w-sm text-small text-muted">
                            فروش گیفت کارت با تحویل آنی کد. اگر کدی که خریده‌اید فعال نشود، جایگزین
                            می‌کنیم یا وجه را برمی‌گردانیم.
                        </p>

                        {/* The eNamad seal. THREE THINGS IN IT LOOK LIKE NOISE AND ARE NOT:

                            `referrerPolicy="origin"` on BOTH elements. enamad decides what to
                            serve from the Referer header - the seal is licensed to one domain -
                            so a stricter policy gets a broken image and a page saying this site
                            is not the licensee.

                            `rel="noopener"` WITHOUT the `noreferrer` that usually rides along
                            with it, for the same reason: the new tab must not get a handle on
                            this window, but it must still say where it came from.

                            The non-standard `code` attribute, which is what enamad's own
                            checker looks for when it verifies the seal is really on the site.

                            The white plate is not decoration either. This is a fixed-colour
                            image, and on the dark theme it would otherwise sit on navy. */}
                        <a
                            className="mt-5 inline-block rounded-xl bg-white p-2"
                            href={`https://trustseal.enamad.ir/?id=${ENAMAD.id}&Code=${ENAMAD.code}`}
                            target="_blank"
                            rel="noopener"
                            referrerPolicy="origin"
                        >
                            <img
                                className="block h-auto w-24"
                                src={`https://trustseal.enamad.ir/logo.aspx?id=${ENAMAD.id}&Code=${ENAMAD.code}`}
                                alt="نماد اعتماد الکترونیکی"
                                referrerPolicy="origin"
                                {...SEAL_CODE}
                            />
                        </a>
                    </div>

                    <div>
                        <h2 className="text-h3 font-bold">پشتیبانی</h2>
                        <ul className="mt-3 text-small text-muted">
                            <li>
                                <a
                                    className="flex min-h-tap items-center gap-2 hover:text-firouze"
                                    href={`mailto:${CONTACT.email}`}
                                >
                                    <Mail className="size-4 shrink-0" aria-hidden="true" />
                                    <span dir="ltr" className="latin">
                                        {CONTACT.email}
                                    </span>
                                </a>
                            </li>
                            <li>
                                <a
                                    className="flex min-h-tap items-center gap-2 hover:text-firouze"
                                    href={`tel:${CONTACT.phone.replace(/\s/g, '')}`}
                                >
                                    <Phone className="size-4 shrink-0" aria-hidden="true" />
                                    <span dir="ltr" className="latin">
                                        {CONTACT.phone}
                                    </span>
                                </a>
                            </li>
                            {/* The one contact that leaves for another site, so it opens in a
                                new tab: a buyer who taps support mid-purchase has a phone
                                number typed and a card on the confirm step, and that state
                                lives in this page. Navigating away would throw it out.

                                `rel` is stated rather than left to the browser's default -
                                it costs nothing and does not depend on how new the browser is. */}
                            <li>
                                <a
                                    className="flex min-h-tap items-center gap-2 hover:text-firouze"
                                    href={CONTACT.telegram}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
                                    <span dir="ltr" className="latin">
                                        {CONTACT.telegram}
                                    </span>
                                </a>
                            </li>
                            <li className="flex min-h-tap items-center gap-2">
                                <Clock className="size-4 shrink-0" aria-hidden="true" />
                                {CONTACT.hours}
                            </li>
                        </ul>
                    </div>

                    <div>
                        <h2 className="text-h3 font-bold">راهنما</h2>
                        <ul className="mt-3 text-small text-muted">
                            {NAV_LINKS.map((link) => (
                                <li key={link.href}>
                                    <a
                                        className="flex min-h-tap items-center hover:text-firouze"
                                        href={link.href}
                                    >
                                        {link.label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="border-t border-line">
                    {/* The shop's own name, not a constant: renaming from the console renames
                        the copyright too, the same as the brand and the tab title. */}
                    <p className="mx-auto max-w-6xl px-4 py-5 text-caption text-muted sm:px-5">
                        © {year()} {catalog.appName}. همهٔ حقوق محفوظ است.
                    </p>
                </div>
            </footer>
        </div>
    );
}

export default function App({ url }: { url?: string }): ReactNode {
    const inner = <Chrome />;

    return (
        <ToastProvider>
            <CatalogProvider>
                <AdminSessionProvider>
                    {url === undefined ? (
                        <BrowserRouter>{inner}</BrowserRouter>
                    ) : (
                        <MemoryRouter initialEntries={[url]}>{inner}</MemoryRouter>
                    )}
                </AdminSessionProvider>
            </CatalogProvider>
        </ToastProvider>
    );
}
