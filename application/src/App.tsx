// The shell: navbar, the routed page, and the footer.
//
// Layout uses LOGICAL properties throughout (ms/me, ps/pe, start/end). In an RTL document a
// physical `left` is whichever side the design did not mean - and since `/en` is the same
// layout in an LTR document, that is now the only way the one layout serves both shops.
//
// `url` exists for tests, which pin the route through a memory history rather than a real
// address bar. A browser never passes it.
import { Link2, MessageCircle, Phone, Clock } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, MemoryRouter, Route, Routes, Link, useLocation } from 'react-router';

import { CatalogProvider, useCatalog, useShopName } from './lib/catalog.tsx';
import { routes } from './routes.tsx';
import { CONTACT, ENAMAD } from './lib/content.ts';
import { year } from './lib/format.ts';
import { dirOf, homeOf, LANG_INFO, useCopy, useLang, type Lang } from './lib/lang.ts';
import LanguageMenu from './components/language-menu.tsx';
import ThemeToggle from './components/theme-toggle.tsx';
import MobileNav from './components/mobile-nav.tsx';
import ToastHost from './ui/toast-host.tsx';
import { ToastProvider } from './ui/toast.tsx';
import { AdminSessionProvider } from './pages/admin/session.tsx';

// Absolute, not bare fragments. The bar is shown on every route, and `#cards` from the
// console would navigate to /admin#cards and scroll nowhere - the link has to name the page
// it belongs to as well as the section. And the page is the READER'S shop: an English buyer
// following «cards» must not land in the Persian one.
const COPY: Record<Lang, ChromeCopy> = {
    fa: {
        nav: [
            { section: 'cards', label: 'کارت‌ها' },
            { section: 'how', label: 'روش خرید' },
            { section: 'faq', label: 'سوال‌های پرتکرار' }
        ],
        title: (name: string) => `${name} - خرید گیفت کارت`,
        skip: 'پرش به محتوای اصلی',
        mainNav: 'ناوبری اصلی',
        notFound: 'صفحه پیدا نشد.',
        tagline:
            'فروش گیفت کارت با تحویل آنی کد. اگر کدی که خریده‌اید فعال نشود، جایگزین می‌کنیم یا وجه را برمی‌گردانیم.',
        seal: 'نماد اعتماد الکترونیکی',
        support: 'پشتیبانی',
        guide: 'راهنما',
        rights: 'همهٔ حقوق محفوظ است.'
    },
    en: {
        nav: [
            { section: 'cards', label: 'Cards' },
            { section: 'how', label: 'How it works' },
            { section: 'faq', label: 'FAQ' }
        ],
        title: (name: string) => `${name} - Buy gift cards`,
        skip: 'Skip to main content',
        mainNav: 'Main navigation',
        notFound: 'Page not found.',
        tagline:
            'Gift cards with instant code delivery. If a code you bought does not activate, we replace it or refund you.',
        support: 'Support',
        guide: 'Guide',
        rights: 'All rights reserved.'
    },
    ar: {
        nav: [
            { section: 'cards', label: 'البطاقات' },
            { section: 'how', label: 'طريقة الشراء' },
            { section: 'faq', label: 'الأسئلة الشائعة' }
        ],
        title: (name: string) => `${name} - شراء بطاقات الهدايا`,
        skip: 'انتقل إلى المحتوى الرئيسي',
        mainNav: 'التنقل الرئيسي',
        notFound: 'الصفحة غير موجودة.',
        tagline:
            'بطاقات هدايا مع تسليم فوري للرمز. إذا لم يعمل رمز اشتريته، نستبدله أو نعيد إليك المبلغ.',
        support: 'الدعم',
        guide: 'دليل',
        rights: 'جميع الحقوق محفوظة.'
    },
    es: {
        nav: [
            { section: 'cards', label: 'Tarjetas' },
            { section: 'how', label: 'Cómo funciona' },
            { section: 'faq', label: 'Preguntas frecuentes' }
        ],
        title: (name: string) => `${name} - Compra tarjetas de regalo`,
        skip: 'Saltar al contenido principal',
        mainNav: 'Navegación principal',
        notFound: 'Página no encontrada.',
        tagline:
            'Tarjetas de regalo con entrega instantánea del código. Si un código que compraste no se activa, lo reemplazamos o te devolvemos el dinero.',
        support: 'Soporte',
        guide: 'Guía',
        rights: 'Todos los derechos reservados.'
    },
    pt: {
        nav: [
            { section: 'cards', label: 'Cartões' },
            { section: 'how', label: 'Como funciona' },
            { section: 'faq', label: 'Perguntas frequentes' }
        ],
        title: (name: string) => `${name} - Compre gift cards`,
        skip: 'Pular para o conteúdo principal',
        mainNav: 'Navegação principal',
        notFound: 'Página não encontrada.',
        tagline:
            'Gift cards com entrega instantânea do código. Se um código que você comprou não ativar, nós o substituímos ou devolvemos seu dinheiro.',
        support: 'Suporte',
        guide: 'Guia',
        rights: 'Todos os direitos reservados.'
    },
    hi: {
        nav: [
            { section: 'cards', label: 'कार्ड' },
            { section: 'how', label: 'कैसे खरीदें' },
            { section: 'faq', label: 'अक्सर पूछे जाने वाले प्रश्न' }
        ],
        title: (name: string) => `${name} - गिफ्ट कार्ड खरीदें`,
        skip: 'मुख्य सामग्री पर जाएँ',
        mainNav: 'मुख्य नेविगेशन',
        notFound: 'पेज नहीं मिला।',
        tagline:
            'तुरंत कोड डिलीवरी वाले गिफ्ट कार्ड। अगर आपका खरीदा हुआ कोड सक्रिय नहीं होता, तो हम उसे बदल देते हैं या आपका पैसा लौटा देते हैं।',
        support: 'सहायता',
        guide: 'गाइड',
        rights: 'सर्वाधिकार सुरक्षित।'
    },
    zh: {
        nav: [
            { section: 'cards', label: '礼品卡' },
            { section: 'how', label: '购买流程' },
            { section: 'faq', label: '常见问题' }
        ],
        title: (name: string) => `${name} - 购买礼品卡`,
        skip: '跳到主要内容',
        mainNav: '主导航',
        notFound: '页面未找到。',
        tagline: '礼品卡即时发送兑换码。如果您购买的兑换码无法激活，我们会为您更换或退款。',
        support: '客服支持',
        guide: '指南',
        rights: '保留所有权利。'
    },
    ru: {
        nav: [
            { section: 'cards', label: 'Карты' },
            { section: 'how', label: 'Как купить' },
            { section: 'faq', label: 'Вопросы и ответы' }
        ],
        title: (name: string) => `${name} - Купить подарочные карты`,
        skip: 'Перейти к основному содержанию',
        mainNav: 'Основная навигация',
        notFound: 'Страница не найдена.',
        tagline:
            'Подарочные карты с мгновенной выдачей кода. Если купленный код не активируется, мы заменим его или вернём деньги.',
        support: 'Поддержка',
        guide: 'Справка',
        rights: 'Все права защищены.'
    },
    fr: {
        nav: [
            { section: 'cards', label: 'Cartes' },
            { section: 'how', label: 'Comment ça marche' },
            { section: 'faq', label: 'FAQ' }
        ],
        title: (name: string) => `${name} - Acheter des cartes cadeaux`,
        skip: 'Aller au contenu principal',
        mainNav: 'Navigation principale',
        notFound: 'Page introuvable.',
        tagline:
            "Cartes cadeaux avec livraison instantanée du code. Si un code acheté ne s'active pas, nous le remplaçons ou vous remboursons.",
        support: 'Assistance',
        guide: 'Guide',
        rights: 'Tous droits réservés.'
    },
    tr: {
        nav: [
            { section: 'cards', label: 'Kartlar' },
            { section: 'how', label: 'Nasıl çalışır' },
            { section: 'faq', label: 'Sık sorulan sorular' }
        ],
        title: (name: string) => `${name} - Hediye kartı satın al`,
        skip: 'Ana içeriğe geç',
        mainNav: 'Ana gezinme',
        notFound: 'Sayfa bulunamadı.',
        tagline:
            'Kodu anında teslim edilen hediye kartları. Satın aldığınız kod etkinleşmezse, kodu değiştirir veya paranızı iade ederiz.',
        support: 'Destek',
        guide: 'Rehber',
        rights: 'Tüm hakları saklıdır.'
    }
};

interface ChromeCopy {
    nav: Array<{ section: string; label: string }>;
    title: (name: string) => string;
    skip: string;
    mainNav: string;
    notFound: string;
    tagline: string;
    support: string;
    guide: string;
    rights: string;

    /** The eNamad seal's alt text. Persian only: the seal is shown only on the Persian page. */
    seal?: string;
}

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
    const lang = useLang();
    const t = useCopy(COPY);
    const name = useShopName();
    const navLinks = t.nav.map((link) => ({
        href: `${homeOf(lang)}#${link.section}`,
        label: link.label
    }));

    // The console is Persian only, so it offers no way out to another language.
    const inConsole = useLocation().pathname.startsWith('/admin');

    useEffect(() => {
        if (!loaded) {
            void load();
        }
    }, [loaded, load]);

    // The document's language and direction follow the address. index.html sets them before
    // the first paint for a reader who arrives on `/ar` or `/en`; this keeps them right as
    // they move.
    useEffect(() => {
        document.documentElement.lang = LANG_INFO[lang].locale;
        document.documentElement.dir = dirOf(lang);
    }, [lang]);

    // The title is in a built file, so a rebrand would leave it stale. Setting it here is
    // what makes the name in the console the name in the browser tab, in the reader's words.
    useEffect(() => {
        document.title = t.title(name);
    }, [t, name]);

    return (
        <div>
            <a
                href="#main"
                className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-small focus:font-bold"
            >
                {t.skip}
            </a>

            <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur">
                <nav
                    className="relative mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-4 sm:px-5"
                    aria-label={t.mainNav}
                >
                    {/* The brand goes HOME, not to an in-page anchor: `#main` sent the console
                        to /admin#main, which looks broken and leaves the operator stranded. */}
                    <Link to={homeOf(lang)} className="flex min-h-tap items-center gap-2 font-bold">
                        <Link2 className="size-6 text-firouze" aria-hidden="true" />
                        {name}
                    </Link>

                    <ul className="ms-6 hidden items-center gap-6 text-small text-muted md:flex">
                        {navLinks.map((link) => (
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
                        {!inConsole && <LanguageMenu />}
                        <ThemeToggle />
                        <MobileNav links={navLinks} />
                    </div>
                </nav>
            </header>

            <main id="main">
                <Routes>
                    {routes.map(({ path, Component }) => (
                        <Route key={path} path={path} element={<Component />} />
                    ))}
                    <Route path="*" element={<p className="p-10 text-center">{t.notFound}</p>} />
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
                            {name}
                        </p>
                        <p className="mt-3 max-w-sm text-small text-muted">{t.tagline}</p>

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
                        {/* Persian only: the seal is an Iranian licence, and means nothing to
                            a reader of any other page. */}
                        {lang === 'fa' && (
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
                                    alt={t.seal ?? ''}
                                    referrerPolicy="origin"
                                    {...SEAL_CODE}
                                />
                            </a>
                        )}
                    </div>

                    <div>
                        <h2 className="text-h3 font-bold">{t.support}</h2>
                        <ul className="mt-3 text-small text-muted">
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
                                {CONTACT.hours[lang]}
                            </li>
                        </ul>
                    </div>

                    <div>
                        <h2 className="text-h3 font-bold">{t.guide}</h2>
                        <ul className="mt-3 text-small text-muted">
                            {navLinks.map((link) => (
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
                        © {year(lang)} {name}. {t.rights}
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
