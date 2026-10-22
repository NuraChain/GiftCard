// The language switcher: the current language's flag, and a menu of every language.
//
// Each choice is a real link to that language's page, named IN ITS OWN LANGUAGE - the reader
// who needs this control is exactly the one who cannot read the page it is on. The flag is
// decoration beside the name (`alt=""`): a flag is a country, not a language.
//
// A DISCLOSURE, not an ARIA menu, for the reason given in ./mobile-nav.tsx: a list of links
// needs no roving focus or key handling beyond Escape, and cannot trap anybody.
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { homeOf, LANG_INFO, LANGS, useCopy, useLang, type Lang } from '../lib/lang.ts';

const COPY: Record<Lang, string> = {
    en: 'Language',
    fa: 'زبان',
    ar: 'اللغة',
    es: 'Idioma',
    pt: 'Idioma',
    hi: 'भाषा',
    zh: '语言',
    ru: 'Язык',
    fr: 'Langue',
    tr: 'Dil'
};

export function Flag({ lang }: { lang: Lang }): ReactNode {
    return (
        <img
            src={`/flags/${LANG_INFO[lang].flag}.svg`}
            alt=""
            width={20}
            height={15}
            className="h-[15px] w-5 shrink-0 rounded-[3px] object-cover ring-1 ring-line"
        />
    );
}

export default function LanguageMenu(): ReactNode {
    const current = useLang();
    const label = useCopy(COPY);
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const panel = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                setOpen(false);
                trigger.current?.focus();
            }
        };
        // Armed one task late, like the mobile nav: the press that opened it is still travelling.
        let onOutside: ((event: Event) => void) | undefined;
        const arm = setTimeout(() => {
            onOutside = (event: Event): void => {
                const target = event.target as Node | null;
                if (
                    target !== null &&
                    !(panel.current?.contains(target) ?? false) &&
                    !(trigger.current?.contains(target) ?? false)
                ) {
                    setOpen(false);
                }
            };
            document.addEventListener('pointerdown', onOutside);
        }, 0);
        document.addEventListener('keydown', onKey);
        return () => {
            clearTimeout(arm);
            document.removeEventListener('keydown', onKey);
            if (onOutside !== undefined) {
                document.removeEventListener('pointerdown', onOutside);
            }
        };
    }, [open]);

    return (
        <div className="relative">
            <button
                type="button"
                ref={trigger}
                className="flex min-h-tap items-center gap-1.5 rounded-xl border border-line px-3 text-small font-bold text-muted hover:border-firouze hover:text-firouze"
                aria-expanded={open ? 'true' : 'false'}
                aria-controls="language-menu-panel"
                aria-label={`${label}: ${LANG_INFO[current].name}`}
                onClick={() => setOpen((value) => !value)}
            >
                <Flag lang={current} />
                <span className="hidden sm:inline" lang={LANG_INFO[current].locale}>
                    {LANG_INFO[current].name}
                </span>
                <ChevronDown className="size-4" aria-hidden="true" />
            </button>

            {open && (
                <div
                    id="language-menu-panel"
                    ref={panel}
                    className="anim-settle absolute end-0 top-full z-50 mt-2 w-48 rounded-xl border border-line bg-paper p-1.5 shadow-lg"
                >
                    <ul className="flex flex-col">
                        {LANGS.map((lang) => (
                            <li key={lang}>
                                <Link
                                    to={homeOf(lang)}
                                    lang={LANG_INFO[lang].locale}
                                    aria-current={lang === current ? 'true' : undefined}
                                    className={`flex min-h-tap items-center gap-2.5 rounded-lg px-3 text-small hover:bg-surface hover:text-firouze ${
                                        lang === current ? 'font-bold text-firouze' : ''
                                    }`}
                                    onClick={() => setOpen(false)}
                                >
                                    <Flag lang={lang} />
                                    {LANG_INFO[lang].name}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
