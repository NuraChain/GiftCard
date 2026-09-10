// The console's frame: the lock, the tabs, and the sign-out. Every tab renders inside it.
//
// The tabs are LINKS in a <nav>, not `role="tab"` panels. They change the URL, so they are
// pages - and calling them tabs in the accessibility tree would tell a screen reader they
// are something they are not. `aria-current="page"` is how the active one announces itself.
import { Boxes, ClipboardPaste, Eye, EyeOff, LockKeyhole, LogOut, Settings, Ticket, Receipt } from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import { failureText } from '../../lib/api.ts';
import { useCatalog } from '../../lib/catalog.tsx';
import { count } from '../../lib/format.ts';
import { useToasts } from '../../ui/toast.tsx';
import Button from '../../ui/button.tsx';
import { useAdminSession } from './session.tsx';

const TABS =
[
    { to: '/admin', label: 'نمای کلی', glyph: Boxes },
    { to: '/admin/codes', label: 'کدها', glyph: Ticket },
    { to: '/admin/orders', label: 'سفارش‌ها', glyph: Receipt },
    { to: '/admin/settings', label: 'تنظیمات', glyph: Settings }
];

/**
 * Everything the key is NOT made of. The alphabet mirrors the server's
 * `ADMIN_KEY_PATTERN` exactly, and it leaves out I, O, 0 and 1 - the four characters
 * people swap for one another when copying a key off a terminal.
 */
const NOT_KEY_CHARS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

/** Four groups of four. */
const SEGMENTS = [0, 1, 2, 3];

export default function AdminShell({ children }: { children: ReactNode }): ReactNode
{
    const session = useAdminSession();
    const notify = useToasts();
    const location = useLocation();
    const catalog = useCatalog();

    const [parts, setParts] = useState(['', '', '', '']);
    const [revealKey, setRevealKey] = useState(false);
    const [rejected, setRejected] = useState(false);
    const [signInError, setSignInError] = useState('');
    const [signingIn, setSigningIn] = useState(false);
    const [shaking, setShaking] = useState(false);

    const typed = parts.join('').length;
    const complete = typed === 16;

    const box = useRef<HTMLDivElement | null>(null);
    const shakeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const { checked, verify } = session;
    useEffect(() =>
    {
        if (!checked)
        {
            void verify();
        }
    }, [checked, verify]);

    useEffect(() => () => clearTimeout(shakeTimer.current), []);

    const focusSegment = (index: number): void =>
    {
        const input = box.current?.querySelectorAll<HTMLInputElement>('input')[index];
        input?.focus();
        // Selected rather than appended: a group you come back to is one you are correcting,
        // and typing should replace it rather than be refused as a 5th character. It is also
        // what makes retyping the whole key from group one work.
        input?.select();
    };

    /**
     * Accepts characters into a group and OVERFLOWS the rest into the groups after it, so
     * one path handles typing, a pasted group, and a pasted whole key alike.
     */
    const acceptInto = (index: number, raw: string): void =>
    {
        const clean = raw.toUpperCase().replace(NOT_KEY_CHARS, '');
        // Separators are not "rejected characters" - a pasted key is full of them.
        setRejected(clean.length !== raw.replace(/[\s-]/g, '').length);
        setSignInError('');

        const next = [...parts];
        let cursor = index;
        let rest = clean;
        do
        {
            next[cursor] = rest.slice(0, 4);
            rest = rest.slice(4);
            cursor += 1;
        }
        while (rest !== '' && cursor <= 3);
        setParts(next);

        if (next[index].length === 4)
        {
            focusSegment(Math.min(cursor, 3));
        }
    };

    /** Backspace at the start of an empty group steps back and eats the previous character. */
    const onSegmentKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>): void =>
    {
        if (event.key === 'Backspace' && parts[index] === '' && index > 0)
        {
            event.preventDefault();
            const next = [...parts];
            next[index - 1] = next[index - 1].slice(0, -1);
            setParts(next);
            focusSegment(index - 1);
        }
    };

    /**
     * A whole key lands in group one wherever it was dropped: what people paste is the
     * entire credential, and making them aim it at the first box is a pointless demand.
     */
    const onSegmentPaste = (index: number, event: ClipboardEvent<HTMLInputElement>): void =>
    {
        const text = event.clipboardData.getData('text');
        event.preventDefault();
        // Uppercased BEFORE it is measured: keys are pasted in whatever case they were stored
        // in, and a lowercase key measured against an uppercase alphabet counts as zero
        // characters - which sent a whole key into the group it was dropped on.
        const size = text.toUpperCase().replace(NOT_KEY_CHARS, '').length;
        acceptInto(size > 4 ? 0 : index, text);
    };

    /**
     * One tap instead of the long-press-and-aim a phone otherwise demands. `readText` needs a
     * user gesture and can still be refused outright (Firefox asks, Safari prompts), so a
     * refusal says what to do next rather than failing quietly.
     */
    const pasteFromClipboard = async (): Promise<void> =>
    {
        try
        {
            acceptInto(0, await navigator.clipboard.readText());
        }
        catch
        {
            notify.info('دسترسی به حافظهٔ موقت داده نشد. کلید را داخل کادرها بچسبانید.');
        }
    };

    const signIn = async (event: FormEvent): Promise<void> =>
    {
        event.preventDefault();
        setSigningIn(true);
        setSignInError('');
        try
        {
            await session.signIn(parts.join('-'));
            setParts(['', '', '', '']);
        }
        catch (error)
        {
            setSignInError(failureText(error, 'ورود ممکن نشد'));
            // The groups are KEPT, not cleared: one mistyped character should not cost the
            // other fifteen. Group one is selected instead, so retyping from the start
            // overwrites everything and correcting one group is still a four-key job.
            clearTimeout(shakeTimer.current);
            setShaking(true);
            shakeTimer.current = setTimeout(() => setShaking(false), 600);
            focusSegment(0);
        }
        finally
        {
            setSigningIn(false);
        }
    };

    const signOut = async (): Promise<void> =>
    {
        await session.signOut();
        notify.info('از کنسول خارج شدید');
    };

    // Nothing is drawn until the session answer is in: flashing the lock screen at an
    // operator who IS signed in reads as being logged out.
    if (!session.checked)
    {
        return (
            <div className="mx-auto max-w-6xl px-4 py-stack sm:px-5">
                <div className="anim-pulse mx-auto mt-section h-48 max-w-sm rounded-2xl border border-line bg-surface"></div>
            </div>
        );
    }

    if (!session.unlocked)
    {
        return (
            <div className="mx-auto max-w-6xl px-4 py-stack sm:px-5">
                <div className="anim-settle mx-auto mt-section max-w-sm rounded-2xl border border-line bg-surface p-5 sm:p-6">
                    <div className="flex size-12 items-center justify-center rounded-2xl bg-firouze/10 text-firouze">
                        <LockKeyhole className="size-6" aria-hidden="true"/>
                    </div>
                    <h1 className="mt-4 text-h3 font-bold">ورود به کنسول</h1>
                    <p className="mt-2 text-small text-muted">
                        حساب کاربری و رمزی در کار نیست. کلید ۱۶ نویسه‌ای مدیریت تنها راه ورود است.
                    </p>

                    <form className="mt-6" noValidate onSubmit={ (event) => void signIn(event) }>
                        <div className="flex items-center justify-between gap-2">
                            <label className="text-small font-bold" htmlFor="admin-key-0">کلید مدیریت</label>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    className="flex min-h-tap items-center gap-1.5 rounded-lg px-2 text-caption text-muted hover:text-firouze"
                                    onClick={ () => void pasteFromClipboard() }
                                >
                                    <ClipboardPaste className="size-4" aria-hidden="true"/>
                                    چسباندن
                                </button>
                                <button
                                    type="button"
                                    className="flex min-h-tap items-center gap-1.5 rounded-lg px-2 text-caption text-muted hover:text-firouze"
                                    aria-pressed={ revealKey ? 'true' : 'false' }
                                    onClick={ () => setRevealKey((current) => !current) }
                                >
                                    { revealKey
                                        ? <EyeOff className="size-4" aria-hidden="true"/>
                                        : <Eye className="size-4" aria-hidden="true"/> }
                                    { revealKey ? 'پنهان' : 'نمایش' }
                                </button>
                            </div>
                        </div>

                        {/* Four boxes, not one field. A 16-character key is transcribed by eye,
                            and a group of four is the length a person can hold in their head
                            between glances - which is why the key is printed in groups too.
                            The container is LTR so the groups fill left to right, the order
                            they are read in. */}
                        <div dir="ltr" className={ `mt-3 flex gap-2 ${ shaking ? 'anim-shake' : '' }` } ref={ box }>
                            { SEGMENTS.map((index) => (
                                <input
                                    key={ index }
                                    id={ `admin-key-${ index }` }
                                    type={ revealKey ? 'text' : 'password' }
                                    inputMode="text"
                                    autoComplete="off"
                                    autoCapitalize="characters"
                                    autoCorrect="off"
                                    spellCheck={ false }
                                    maxLength={ 4 }
                                    aria-label={ `گروه ${ count(index + 1) } از ۴` }
                                    aria-invalid={ signInError !== '' ? 'true' : 'false' }
                                    className={ `latin min-h-tap w-full min-w-0 rounded-xl border-2 bg-paper px-1 text-center text-lg font-bold tracking-widest outline-none transition-colors ${
                                        signInError !== ''
                                            ? 'border-danger'
                                            : parts[index].length === 4
                                                ? 'border-firouze/60 focus:border-firouze'
                                                : 'border-line focus:border-firouze'
                                    }` }
                                    value={ parts[index] }
                                    onChange={ (event) => acceptInto(index, event.target.value) }
                                    onKeyDown={ (event) => onSegmentKeyDown(index, event) }
                                    onPaste={ (event) => onSegmentPaste(index, event) }
                                    onFocus={ (event) => event.target.select() }
                                />
                            )) }
                        </div>

                        {/* One line, four jobs: what went wrong, what the key is made of, how
                            much is left, or where to find it. They are mutually exclusive and
                            the space is reserved, so the button does not jump as you type. */}
                        <p className="mt-3 min-h-10 text-caption" aria-live="polite">
                            { signInError !== '' ? (
                                <span className="font-bold text-danger">{ signInError }</span>
                            ) : rejected ? (
                                <span className="text-gold">
                                    کلید حرف
                                    <span dir="ltr" className="latin mx-1">I</span>
                                    و
                                    <span dir="ltr" className="latin mx-1">O</span>
                                    و رقم‌های ۰ و ۱ ندارد.
                                </span>
                            ) : typed > 0 ? (
                                <span className="text-muted">{ 16 - typed === 0 ? 'کلید کامل است.' : `${ 16 - typed } نویسه مانده` }</span>
                            ) : (
                                <span className="text-muted">کلید هنگام نخستین اجرای سرور، یک بار در ترمینال چاپ می‌شود.</span>
                            ) }
                        </p>

                        <Button
                            type="submit"
                            variant="primary"
                            full
                            className="mt-2"
                            busy={ signingIn }
                            busyText="در حال بررسی..."
                            disabled={ !complete }
                        >
                            ورود
                        </Button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-6xl px-4 py-stack sm:px-5">
            <header className="flex flex-wrap items-center gap-3">
                <h1 className="text-h3 font-bold">کنسول { catalog.appName }</h1>
                <Button variant="retreat" glyph={ LogOut } compact className="ms-auto" onClick={ () => void signOut() }>
                    خروج
                </Button>
            </header>

            {/* All four on one line at every width, and every one of them one tap away.
                Wrapping stranded the active underline on a second row; scrolling the strip
                was worse still, because a tab you have to find before you can press it is
                not a tab. What gives on a phone is the ICONS - the labels are the thing
                being pressed, so they are what stays. */}
            <nav className="mt-5 flex gap-1 border-b border-line" aria-label="بخش‌های کنسول">
                { TABS.map((tab) =>
                {
                    const Glyph = tab.glyph;
                    const active = location.pathname === tab.to;
                    return (
                        <Link
                            key={ tab.to }
                            to={ tab.to }
                            className={ `-mb-px flex min-h-tap flex-1 items-center justify-center gap-2 border-b-2 px-1 text-caption font-bold transition-colors sm:flex-none sm:justify-start sm:px-4 sm:text-small ${
                                active ? 'border-firouze text-firouze' : 'border-transparent text-muted hover:text-ink'
                            }` }
                            aria-current={ active ? 'page' : undefined }
                        >
                            <Glyph className="size-4 shrink-0 max-sm:hidden" aria-hidden="true"/>
                            { tab.label }
                        </Link>
                    );
                }) }
            </nav>

            <div className="mt-stack">
                { children }
            </div>
        </div>
    );
}
