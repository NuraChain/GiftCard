// The landing page.
//
// It argues one thing: what you buy is a code, and this is exactly what happens to it. The
// hero shows that code as the artifact it is, the cards carry the purchase itself, and the
// FAQ answers the fears in the buyer's own words.
//
// The payment RESULT is first on the page rather than last, and renders only when there is
// one. A buyer who lands here is coming back from the bank and has exactly one question;
// making them scroll past the shop to find the answer would be a strange thing to do to
// somebody who has just paid.
import { useEffect, useState, type ReactNode } from 'react';

import { useCatalog } from '../lib/catalog.tsx';
import { STEPS, FAQS, ASSURANCES, CONTACT } from '../lib/content.ts';
import Async from '../ui/async.tsx';
import CodeCapsule from '../components/code-capsule.tsx';
import GiftCard from '../components/gift-card.tsx';
import FaqItem from '../components/faq-item.tsx';
import PurchaseResult from '../components/purchase-result.tsx';

export default function Landing(): ReactNode {
    const catalog = useCatalog();

    // The hero capsule resolves from scanning to verified once, on load.
    const [scanning, setScanning] = useState(false);
    const [verified, setVerified] = useState(true);

    useEffect(() => {
        setScanning(true);
        setVerified(false);
        const timer = setTimeout(() => {
            setScanning(false);
            setVerified(true);
        }, 4200);
        return () => clearTimeout(timer);
    }, []);

    const [openFaq, setOpenFaq] = useState<string | null>(FAQS[0].id);
    const toggleFaq = (id: string): void => setOpenFaq((current) => (current === id ? null : id));

    return (
        <div>
            <PurchaseResult />

            <section className="mx-auto grid max-w-6xl items-center gap-stack px-4 pt-section pb-stack sm:px-5 lg:grid-cols-[1.05fr_1fr]">
                <div className="anim-settle">
                    <p className="text-small font-bold text-firouze">گیفت کارت {catalog.appName}</p>
                    <h1 className="mt-4 font-bold">
                        کد را همان لحظه تحویل می‌گیرید، نه بعد از انتظار
                    </h1>
                    <p className="mt-5 max-w-xl text-muted">
                        آنچه می‌خرید یک کد است. اینجا دقیقاً می‌بینید که چه شکلی دارد
                    </p>

                    <div className="mt-stack flex flex-wrap gap-3">
                        <a
                            href="#cards"
                            className="flex min-h-tap items-center rounded-xl bg-firouze px-5 text-small font-bold text-paper hover:opacity-90"
                        >
                            دیدن کارت‌ها
                        </a>
                        <a
                            href="#how"
                            className="flex min-h-tap items-center rounded-xl border border-line px-5 text-small font-bold hover:border-firouze hover:text-firouze"
                        >
                            روش خرید
                        </a>
                    </div>
                </div>

                <div className="anim-settle">
                    <CodeCapsule
                        code="7f3c1e2a-9b04-4d68-a5c1-0e7b2d9f4a31"
                        label="نمونه کد - این کد واقعی نیست"
                        scanning={scanning}
                        verified={verified}
                    />
                    <p className="mt-3 text-caption text-muted">
                        کد شما پس از پرداخت به همین شکل نمایش داده می‌شود و همزمان با پیامک به دستتان
                        می‌رسد.
                    </p>
                </div>
            </section>

            <section className="mx-auto max-w-6xl px-4 pb-section sm:px-5">
                <ul className="stagger grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-surface lg:grid-cols-4">
                    {ASSURANCES.map((item) => {
                        const Glyph = item.glyph;
                        return (
                            <li key={item.label} className="trust-cell p-4">
                                <Glyph className="size-5 text-firouze" aria-hidden="true" />
                                <p className="mt-2.5 text-small font-bold">{item.label}</p>
                                <p className="mt-1 text-caption text-muted">{item.detail}</p>
                            </li>
                        );
                    })}
                </ul>
            </section>

            <section id="cards" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-section sm:px-5">
                <h2 className="font-bold">کارت خود را انتخاب کنید</h2>
                <p className="mt-3 max-w-xl text-muted">
                    {/* No count in this sentence: the catalogue is editable, so "all three" was
                        a promise the page could not keep the moment a fourth card was added. */}
                    شماره موبایلتان را روی همان کارتی که می‌خواهید وارد کنید. همهٔ کارت‌ها یک نوع کد
                    می‌دهند و یک جور تحویل می‌شوند.
                </p>

                <div className="mt-stack">
                    <Async
                        loading={catalog.loading && !catalog.loaded}
                        error={catalog.error}
                        empty={catalog.loaded && catalog.tiers.length === 0}
                        emptyText="در حال حاضر کارتی برای فروش نیست."
                        onRetry={() => void catalog.load()}
                        skeleton={
                            <div className="grid gap-5 md:grid-cols-3">
                                <div className="anim-pulse h-96 rounded-2xl border border-line bg-surface"></div>
                                <div className="anim-pulse h-96 rounded-2xl border border-line bg-surface"></div>
                                <div className="anim-pulse h-96 rounded-2xl border border-line bg-surface"></div>
                            </div>
                        }
                    >
                        <div className="grid gap-5 md:grid-cols-3">
                            {catalog.tiers.map((tier) => (
                                <GiftCard key={tier.amount} tier={tier} />
                            ))}
                        </div>
                    </Async>
                </div>
            </section>

            <section id="how" className="border-y border-line bg-surface/40">
                <div className="mx-auto max-w-6xl scroll-mt-20 px-4 py-section sm:px-5">
                    <h2 className="font-bold">از پرداخت تا کد فعال</h2>
                    <ol className="mt-stack grid gap-6 md:grid-cols-3">
                        {STEPS.map((step, index) => {
                            const Glyph = step.glyph;
                            return (
                                <li
                                    key={step.title}
                                    className="rounded-2xl border border-line bg-surface p-5"
                                >
                                    <div className="flex items-center gap-2.5 text-firouze">
                                        <Glyph className="size-5 shrink-0" aria-hidden="true" />
                                        <span
                                            dir="ltr"
                                            className="latin inline-block text-caption font-bold"
                                        >
                                            {index + 1}
                                        </span>
                                    </div>
                                    <h3 className="mt-3 font-bold">{step.title}</h3>
                                    <p className="mt-2 text-small text-muted">{step.body}</p>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            </section>

            <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-section sm:px-5">
                <h2 className="font-bold">سوال‌های پرتکرار</h2>
                <p className="mt-3 text-muted">
                    اگر پاسخ سوالتان اینجا نبود، به{' '}
                    <span dir="ltr" className="latin">
                        {CONTACT.email}
                    </span>{' '}
                    بنویسید.
                </p>

                <div className="mt-6 rounded-2xl border border-line bg-surface px-5">
                    {FAQS.map((faq) => (
                        <FaqItem
                            key={faq.id}
                            id={faq.id}
                            question={faq.question}
                            answer={faq.answer}
                            open={openFaq === faq.id}
                            onToggle={toggleFaq}
                        />
                    ))}
                </div>
            </section>
        </div>
    );
}
