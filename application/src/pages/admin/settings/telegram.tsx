// The operations bot: a ping when something sells, and the database on a schedule this page
// sets.
//
// TWO BUTTONS, AND THEY ARE THE POINT. A bot token that is subtly wrong fails silently -
// there is no sale to notice it on until there is a sale, and no backup to miss until the day
// you need one. «ارسال پیام آزمایشی» and «پشتیبان‌گیری همین حالا» turn both of those from
// something you find out later into something you find out now.
//
// THE WARNING ABOVE THE BACKUP BUTTON IS NOT BOILERPLATE. That upload is every unsold gift
// code in the shop, sent to a chat. It is the right trade - a business whose only copy of its
// inventory is one disk is one disk failure from losing it - but the operator has to know
// they are making it, and to whom.
//
// THE PROXY LIST SAVES ITSELF, a row at a time, and the form above it does not. A proxy that
// is added, changed or removed is written at once: a «حذف» that waits for a save button
// further up the page is a delete that did not happen, and the operator finds out when the
// bot is still using the proxy they thought was gone. «تست» is separate from all of it - it
// tries the row and changes nothing.
//
// THERE ARE TWO «تست» BUTTONS AND THEY TRY DIFFERENT THINGS. The one on a row tries the proxy
// as it is SAVED, with the password this page was never shown. The one in the form tries what
// is in the boxes, password included, before any of it is saved - which is the only way to
// find out that a password is wrong without first storing it.
import {
    Activity,
    AlertTriangle,
    CircleCheck,
    CircleX,
    DatabaseBackup,
    KeyRound,
    Plus,
    Radio,
    Save,
    Send,
    Trash2
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import {
    DEFAULT_BACKUP_MINUTES,
    MAX_BACKUP_MINUTES,
    MIN_BACKUP_MINUTES,
    parseProxyUrl,
    proxyAddress,
    telegramProxy,
    type TelegramProxy,
    type TelegramProxyTest,
    type TelegramProxyView,
    type TelegramStatusView
} from '../../../../../server/src/contract/index.ts';
import { count } from '../../../lib/format.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import Select from '../../../ui/select.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

/** The server's own ceiling, repeated here so the button can say so before a request does. */
const MAX_PROXIES = 20;

/**
 * How the proxy itself is spoken to. Written as the start of an address because that is where
 * the operator has seen it: whatever their proxy's address begins with is the one to pick.
 */
const PROTOCOL_OPTIONS = [
    { value: 'http', label: 'http://', latin: true },
    { value: 'https', label: 'https://', latin: true }
];

/**
 * A proxy as the form holds it: text in every box, because that is what a box contains.
 * `index` is the row being changed, or null for one that is not in the list yet.
 */
interface ProxyDraft {
    index: number | null;
    link: string;
    protocol: TelegramProxy['protocol'];
    server: string;
    port: string;
    username: string;
    password: string;
}

const EMPTY_DRAFT: ProxyDraft = {
    index: null,
    link: '',
    protocol: 'http',
    server: '',
    port: '',
    username: '',
    password: ''
};

/**
 * A row as it is sent back to the server: without a password, because this page was never
 * given one. A blank password is kept as the one already stored for that address.
 */
function unchanged(proxy: TelegramProxyView): TelegramProxy {
    return {
        protocol: proxy.protocol,
        server: proxy.server,
        port: proxy.port,
        username: proxy.username,
        password: ''
    };
}

/**
 * What a test found, or nothing while there is nothing to say. Said in words and an icon, not
 * in colour alone. The element it sits in is always in the tree and has `role="status"`, so a
 * result that arrives later is announced rather than only drawn.
 */
function TestResult(props: { result: TelegramProxyTest | null | undefined }): ReactNode {
    const { result } = props;
    if (result === null || result === undefined) {
        return null;
    }
    return result.ok ? (
        <>
            <CircleCheck className="size-4 shrink-0 text-firouze" aria-hidden="true" />
            <span className="font-bold text-firouze">سالم، {count(result.ms)} میلی‌ثانیه</span>
        </>
    ) : (
        <>
            <CircleX className="size-4 shrink-0 text-danger" aria-hidden="true" />
            <span className="font-bold text-danger">ناموفق:</span>
            <span dir="ltr" className="latin break-words text-danger">
                {result.reason}
            </span>
        </>
    );
}

export default function TelegramSettings(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();

    const [status, setStatus] = useState<TelegramStatusView | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [backingUp, setBackingUp] = useState(false);

    // The token starts EMPTY, not pre-filled: there is no stored value to pre-fill with,
    // because the server never sends one. Blank means "unchanged".
    const [formToken, setFormToken] = useState('');
    const [formChatId, setFormChatId] = useState('');
    const [formBase, setFormBase] = useState('');
    const [formMinutes, setFormMinutes] = useState('');

    const [draft, setDraft] = useState<ProxyDraft | null>(null);
    const [draftError, setDraftError] = useState('');
    const [savingProxy, setSavingProxy] = useState(false);
    // `null` while a test is in flight. A row that was never tested has no entry at all.
    const [tests, setTests] = useState<Record<string, TelegramProxyTest | null>>({});
    // The same for the form, where `undefined` is "not tried as it now stands".
    const [draftTest, setDraftTest] = useState<TelegramProxyTest | null | undefined>(undefined);
    // Which try of the form is the current one. An answer to an earlier one is about boxes
    // that have since been changed, and is dropped.
    const draftTry = useRef(0);

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.telegram();
            setStatus(view);
            setFormChatId(view.chatId);
            setFormBase(view.baseUrl);
            setFormMinutes(String(view.backupEveryMinutes));
        } catch (failure) {
            setError(failureText(failure, 'تنظیمات ربات خوانده نشد'));
        } finally {
            setLoading(false);
        }
    }, []);

    // Keyed on the session, not on mount - see the note in overview.tsx.
    useEffect(() => {
        if (session.unlocked) {
            void load();
        }
    }, [session.revision, session.unlocked, load]);

    const save = async (event: FormEvent): Promise<void> => {
        event.preventDefault();

        // The same band the server enforces, checked here first so the operator gets a
        // sentence rather than a rejected request.
        const minutes = Number(formMinutes);
        if (
            !Number.isInteger(minutes) ||
            minutes < MIN_BACKUP_MINUTES ||
            minutes > MAX_BACKUP_MINUTES
        ) {
            notify.error(
                `فاصلهٔ پشتیبان‌گیری باید عددی صحیح بین ${count(MIN_BACKUP_MINUTES)} و ` +
                    `${count(MAX_BACKUP_MINUTES)} دقیقه باشد`
            );
            return;
        }

        setSaving(true);
        try {
            await client.admin.saveSettings({
                input: {
                    telegramChatId: formChatId,
                    telegramBase: formBase,
                    backupEveryMinutes: minutes,
                    // Absent, not empty: a blank token box must not switch the bot off.
                    telegramBotToken: formToken === '' ? undefined : formToken
                }
            });
            setFormToken('');
            await load();
            notify.success('تنظیمات ربات ذخیره شد');
        } catch (failure) {
            notify.error(failureText(failure, 'ذخیره نشد'));
        } finally {
            setSaving(false);
        }
    };

    const sendTest = async (): Promise<void> => {
        setTesting(true);
        try {
            const result = await client.admin.testTelegram();
            if (result.ok) {
                notify.success('پیام آزمایشی فرستاده شد. تلگرام را ببینید.');
            } else {
                notify.error(`فرستاده نشد: ${result.reason}`);
            }
        } catch (failure) {
            notify.error(failureText(failure, 'فرستاده نشد'));
        } finally {
            setTesting(false);
        }
    };

    const backupNow = async (): Promise<void> => {
        if (
            !confirm(
                'یک نسخهٔ کامل از دیتابیس - شامل همهٔ کدهای فروش‌نرفته - به همان چت تلگرام فرستاده می‌شود. ادامه؟'
            )
        ) {
            return;
        }
        setBackingUp(true);
        try {
            const result = await client.admin.backupNow();
            if (result.ok) {
                notify.success('پشتیبان فرستاده شد');
            } else {
                notify.error(`فرستاده نشد: ${result.reason}`);
            }
        } catch (failure) {
            notify.error(failureText(failure, 'فرستاده نشد'));
        } finally {
            setBackingUp(false);
        }
    };

    const proxies = status?.proxies ?? [];

    /**
     * Writes the whole list, and nothing but the list. Only the list is read back afterwards,
     * too: `load` refills every box on the page, and somebody half way through typing a new
     * chat id should not lose it because they removed a proxy.
     */
    const saveProxies = async (next: TelegramProxy[], done: string): Promise<boolean> => {
        setSavingProxy(true);
        try {
            await client.admin.saveSettings({ input: { telegramProxies: next } });
            const { proxies: saved } = await client.admin.telegram();
            setStatus((current) => (current === null ? current : { ...current, proxies: saved }));
            notify.success(done);
            return true;
        } catch (failure) {
            notify.error(failureText(failure, 'ذخیره نشد'));
            return false;
        } finally {
            setSavingProxy(false);
        }
    };

    /** Shows the form as `next`. What was said about the form as it stood goes with it. */
    const openDraft = (next: ProxyDraft): void => {
        draftTry.current += 1;
        setDraftError('');
        setDraftTest(undefined);
        setDraft(next);
    };

    /** One box of the form, or several, changed. */
    const edit = (fields: Partial<ProxyDraft>): void => {
        if (draft !== null) {
            openDraft({ ...draft, ...fields });
        }
    };

    /** A pasted address fills the boxes under it. Anything else is left to be typed. */
    const pasteLink = (link: string): void => {
        const parsed = parseProxyUrl(link);
        if (parsed === null) {
            edit({ link });
            return;
        }
        edit({
            link,
            protocol: parsed.protocol,
            server: parsed.server,
            port: String(parsed.port),
            // An address with no login in it says where the proxy is and nothing about who
            // signs in to it, so it must not empty two boxes somebody has just filled in.
            ...(parsed.username === '' && parsed.password === ''
                ? {}
                : { username: parsed.username, password: parsed.password })
        });
    };

    /**
     * The form as a proxy, or null with the reason shown beside it. Saving and testing both
     * start here, so what is tested is exactly what would be saved.
     */
    const readDraft = (): TelegramProxy | null => {
        if (draft === null) {
            return null;
        }

        // The same shape the server enforces, checked here first so the operator gets a
        // sentence beside the form rather than a rejected request.
        const parsed = telegramProxy.safeParse({
            protocol: draft.protocol,
            server: draft.server,
            port: Number(draft.port),
            username: draft.username,
            password: draft.password
        });
        if (!parsed.success) {
            setDraftError(
                'سرور، پورت یا نام کاربری درست نیست. سرور باید نام دامنه یا IP باشد و پورت عددی بین ۱ و ۶۵۵۳۵.'
            );
            return null;
        }
        const address = proxyAddress(parsed.data);
        const taken = proxies.some(
            (proxy, index) => index !== draft.index && proxyAddress(proxy) === address
        );
        if (taken) {
            setDraftError('این پراکسی از قبل در فهرست هست.');
            return null;
        }

        // A stored password belongs to the address it was typed for, and the server will not
        // carry it to another one. Said here, so the row does not quietly lose its password.
        // Taking the username off is the one change that means the login is to go.
        const before = draft.index === null ? undefined : proxies[draft.index];
        if (
            before?.passwordSet === true &&
            parsed.data.password === '' &&
            proxyAddress(before) !== address &&
            !(before.username !== '' && parsed.data.username === '')
        ) {
            setDraftError('نشانی یا نام کاربری پراکسی عوض شده است. رمز عبور را دوباره بنویسید.');
            return null;
        }
        return parsed.data;
    };

    const saveDraft = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        const proxy = readDraft();
        if (draft === null || proxy === null) {
            return;
        }

        const saved =
            draft.index === null
                ? await saveProxies([...proxies.map(unchanged), proxy], 'پراکسی اضافه شد')
                : await saveProxies(
                      proxies.map((old, index) => (index === draft.index ? proxy : unchanged(old))),
                      'پراکسی ذخیره شد'
                  );
        if (saved) {
            setDraft(null);
        }
    };

    /** Tries the form as it stands, with the password in its box, and saves nothing. */
    const testDraft = async (): Promise<void> => {
        const proxy = readDraft();
        if (proxy === null) {
            return;
        }
        draftTry.current += 1;
        const asked = draftTry.current;
        setDraftTest(null);
        let result: TelegramProxyTest;
        try {
            result = await client.admin.testTelegramProxy({ input: proxy });
        } catch (failure) {
            result = { ok: false, reason: failureText(failure, 'تست انجام نشد'), ms: 0 };
        }
        if (asked === draftTry.current) {
            setDraftTest(result);
        }
    };

    const removeProxy = async (index: number): Promise<void> => {
        const proxy = proxies[index];
        if (!confirm(`پراکسی ${proxy.server}:${proxy.port} از فهرست حذف شود؟`)) {
            return;
        }
        if (
            await saveProxies(
                proxies.filter((_, at) => at !== index).map(unchanged),
                'پراکسی حذف شد'
            )
        ) {
            // The rows have moved up, so a form open on one of them is pointing at another.
            setDraft(null);
        }
    };

    const testProxy = async (proxy: TelegramProxyView): Promise<void> => {
        const id = proxyAddress(proxy);
        setTests((current) => ({ ...current, [id]: null }));
        let result: TelegramProxyTest;
        try {
            result = await client.admin.testTelegramProxy({ input: unchanged(proxy) });
        } catch (failure) {
            result = { ok: false, reason: failureText(failure, 'تست انجام نشد'), ms: 0 };
        }
        setTests((current) => ({ ...current, [id]: result }));
    };

    const ready = status?.configured === true;

    return (
        <section className="mt-section">
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <Radio className="size-5 text-firouze" aria-hidden="true" />
                ربات تلگرام
            </h2>
            <p className="mt-2 text-small text-muted">
                با هر فروش یک پیام به این چت می‌رسد، و هر{' '}
                {count(status?.backupEveryMinutes ?? DEFAULT_BACKUP_MINUTES)} دقیقه یک نسخهٔ پشتیبان
                از دیتابیس فرستاده می‌شود. کد گیفت کارت هیچ‌وقت در پیام فروش نمی‌آید.
            </p>

            <div className="mt-4">
                <Async
                    loading={loading && status === null}
                    error={error}
                    onRetry={() => void load()}
                    skeleton={
                        <div className="anim-pulse h-56 rounded-2xl border border-line bg-surface"></div>
                    }
                >
                    <form
                        className="rounded-2xl border border-line bg-surface p-5"
                        noValidate
                        onSubmit={(event) => void save(event)}
                    >
                        <Field
                            label="توکن ربات"
                            htmlFor="telegram-token"
                            hint="از BotFather می‌گیرید. بعد از ذخیره دیگر نمایش داده نمی‌شود؛ برای نگه داشتن مقدار فعلی خالی بگذارید."
                        >
                            <TextInput
                                id="telegram-token"
                                type="password"
                                latin
                                autoComplete="off"
                                placeholder={
                                    status?.botTokenSet === true
                                        ? `${status.botTokenMasked} (برای تغییر بنویسید)`
                                        : 'تنظیم نشده'
                                }
                                value={formToken}
                                onChange={setFormToken}
                            />
                        </Field>

                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <Field
                                label="شناسهٔ چت"
                                htmlFor="telegram-chat"
                                hint="شناسهٔ عددی کاربر یا گروه، یا نام کانال مثل ‎@ashbringerops"
                            >
                                <TextInput
                                    id="telegram-chat"
                                    latin
                                    placeholder="-1001234567890"
                                    value={formChatId}
                                    onChange={setFormChatId}
                                />
                            </Field>
                            <Field label="آدرس API" htmlFor="telegram-base">
                                <TextInput
                                    id="telegram-base"
                                    latin
                                    value={formBase}
                                    onChange={setFormBase}
                                />
                            </Field>
                        </div>

                        <div className="mt-4">
                            <Field
                                label="فاصلهٔ پشتیبان‌گیری (دقیقه)"
                                htmlFor="backup-minutes"
                                hint={`هر چند دقیقه یک نسخهٔ کامل از دیتابیس به این چت فرستاده شود. بین ${count(MIN_BACKUP_MINUTES)} دقیقه و ${count(MAX_BACKUP_MINUTES)} دقیقه (یک هفته). تغییر آن تا یک دقیقه بعد اعمال می‌شود و نیازی به راه‌اندازی دوباره نیست.`}
                            >
                                <TextInput
                                    id="backup-minutes"
                                    type="number"
                                    latin
                                    value={formMinutes}
                                    onChange={setFormMinutes}
                                />
                            </Field>
                        </div>

                        <dl className="mt-5 grid gap-2 border-t border-line pt-4 text-caption text-muted">
                            <div className="flex justify-between gap-2">
                                <dt>وضعیت ربات</dt>
                                <dd
                                    className={
                                        ready ? 'font-bold text-firouze' : 'font-bold text-gold'
                                    }
                                >
                                    {ready ? 'آماده' : 'خاموش'}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt>فاصلهٔ پشتیبان‌گیری</dt>
                                <dd>
                                    {count(status?.backupEveryMinutes ?? DEFAULT_BACKUP_MINUTES)}{' '}
                                    دقیقه
                                </dd>
                            </div>
                        </dl>

                        <Button
                            type="submit"
                            variant="primary"
                            glyph={Save}
                            className="mt-5"
                            busy={saving}
                            busyText="در حال ذخیره..."
                        >
                            ذخیره تنظیمات ربات
                        </Button>
                    </form>

                    <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
                        <div className="flex flex-wrap items-center gap-3">
                            <h3 className="font-bold">پراکسی‌های HTTP / HTTPS</h3>
                            <Button
                                glyph={Plus}
                                size="sm"
                                className="ms-auto"
                                disabled={proxies.length >= MAX_PROXIES}
                                onClick={() => openDraft(EMPTY_DRAFT)}
                            >
                                پراکسی تازه
                            </Button>
                        </div>
                        <p className="mt-2 text-caption text-muted">
                            ربات از راه اولین پراکسی‌ای که جواب بدهد به تلگرام وصل می‌شود، به‌ترتیب
                            همین فهرست، و تا وقتی کار می‌کند روی همان می‌ماند. اگر هیچ‌کدام کار نکند،
                            آدرس API بالا آخرین گزینه است. توکن ربات از دید پراکسی پنهان می‌ماند؛
                            حداکثر {count(MAX_PROXIES)} پراکسی.
                        </p>

                        {proxies.length === 0 ? (
                            <p className="mt-4 text-small text-muted">
                                هنوز پراکسی‌ای اضافه نشده است. ربات مستقیم به آدرس API وصل می‌شود.
                            </p>
                        ) : (
                            <ol className="mt-4 grid gap-3">
                                {proxies.map((proxy, index) => {
                                    const id = proxyAddress(proxy);
                                    const result = tests[id];
                                    return (
                                        <li
                                            key={id}
                                            className="rounded-2xl border border-line bg-paper p-4 sm:flex sm:flex-wrap sm:items-center sm:gap-3"
                                        >
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:contents">
                                                <span className="text-caption text-muted">
                                                    {count(index + 1)}
                                                </span>
                                                <span
                                                    dir="ltr"
                                                    className="latin text-small font-bold break-all"
                                                >
                                                    {id}
                                                </span>
                                                {/* The password itself never comes back to
                                                    this page. That one is stored does, and a
                                                    row has to show it: without this there is
                                                    nothing to say the password was taken. */}
                                                {proxy.passwordSet && (
                                                    <span className="flex items-center gap-1 text-caption text-muted">
                                                        <KeyRound
                                                            className="size-3.5 shrink-0"
                                                            aria-hidden="true"
                                                        />
                                                        با رمز عبور
                                                    </span>
                                                )}
                                                <span
                                                    role="status"
                                                    className="flex items-center gap-1 text-caption"
                                                >
                                                    <TestResult result={result} />
                                                </span>
                                            </div>

                                            <div className="mt-3 flex gap-2 sm:mt-0 sm:ms-auto">
                                                <Button
                                                    size="sm"
                                                    grow
                                                    glyph={Activity}
                                                    busy={result === null}
                                                    busyText="در حال تست..."
                                                    onClick={() => void testProxy(proxy)}
                                                >
                                                    تست
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    grow
                                                    disabled={savingProxy}
                                                    onClick={() =>
                                                        openDraft({
                                                            ...EMPTY_DRAFT,
                                                            index,
                                                            protocol: proxy.protocol,
                                                            server: proxy.server,
                                                            port: String(proxy.port),
                                                            username: proxy.username
                                                        })
                                                    }
                                                >
                                                    ویرایش
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    grow
                                                    variant="retreat"
                                                    glyph={Trash2}
                                                    disabled={savingProxy}
                                                    onClick={() => void removeProxy(index)}
                                                >
                                                    حذف
                                                </Button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}

                        {draft !== null && (
                            <form
                                className="mt-4 rounded-2xl border border-firouze bg-paper p-5"
                                noValidate
                                onSubmit={(event) => void saveDraft(event)}
                            >
                                <h4 className="font-bold">
                                    {draft.index === null
                                        ? 'پراکسی تازه'
                                        : `ویرایش پراکسی ${count(draft.index + 1)}`}
                                </h4>

                                <Field
                                    label="آدرس پراکسی"
                                    htmlFor="proxy-link"
                                    className="mt-4"
                                    hint="آدرس کامل پراکسی را اینجا بچسبانید تا خانه‌های پایین پر شود؛ به شکل host:port:user:pass هم خوانده می‌شود. یا آن‌ها را دستی بنویسید."
                                    error={
                                        draft.link.trim() !== '' &&
                                        parseProxyUrl(draft.link) === null
                                            ? 'این آدرس خوانده نشد. فقط پراکسی HTTP و HTTPS پشتیبانی می‌شود؛ خانه‌های پایین را دستی پر کنید.'
                                            : ''
                                    }
                                >
                                    <TextInput
                                        id="proxy-link"
                                        latin
                                        tone="surface"
                                        inputMode="url"
                                        autoComplete="off"
                                        placeholder="https://user:pass@host:port"
                                        value={draft.link}
                                        onChange={pasteLink}
                                    />
                                </Field>

                                <div className="mt-4 grid gap-4 sm:grid-cols-[9rem_1fr_8rem]">
                                    <Field
                                        label="نوع"
                                        htmlFor="proxy-protocol"
                                        hint="همان چیزی که اول آدرس پراکسی است."
                                    >
                                        <Select
                                            id="proxy-protocol"
                                            label="نوع اتصال به پراکسی"
                                            value={draft.protocol}
                                            options={PROTOCOL_OPTIONS}
                                            onChange={(next) =>
                                                edit({
                                                    protocol: next as TelegramProxy['protocol']
                                                })
                                            }
                                        />
                                    </Field>
                                    <Field label="سرور" htmlFor="proxy-server">
                                        <TextInput
                                            id="proxy-server"
                                            latin
                                            tone="surface"
                                            autoComplete="off"
                                            placeholder="proxy.example.com"
                                            invalid={draftError !== ''}
                                            value={draft.server}
                                            onChange={(next) => edit({ server: next })}
                                        />
                                    </Field>
                                    <Field label="پورت" htmlFor="proxy-port">
                                        <TextInput
                                            id="proxy-port"
                                            latin
                                            tone="surface"
                                            inputMode="numeric"
                                            autoComplete="off"
                                            placeholder="8080"
                                            invalid={draftError !== ''}
                                            value={draft.port}
                                            onChange={(next) => edit({ port: next })}
                                        />
                                    </Field>
                                </div>

                                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                    <Field
                                        label="نام کاربری"
                                        htmlFor="proxy-username"
                                        hint="اگر پراکسی نام کاربری و رمز ندارد، هر دو را خالی بگذارید. هرچه در این دو خانه باشد برای پراکسی فرستاده می‌شود."
                                    >
                                        <TextInput
                                            id="proxy-username"
                                            latin
                                            tone="surface"
                                            autoComplete="off"
                                            invalid={draftError !== ''}
                                            value={draft.username}
                                            onChange={(next) => edit({ username: next })}
                                        />
                                    </Field>
                                    <Field
                                        label="رمز عبور"
                                        htmlFor="proxy-password"
                                        error={draftError}
                                    >
                                        {/* `new-password`, so a browser does not fill in the
                                            console's own saved login here. */}
                                        <TextInput
                                            id="proxy-password"
                                            type="password"
                                            latin
                                            tone="surface"
                                            autoComplete="new-password"
                                            placeholder={
                                                draft.index !== null &&
                                                proxies[draft.index]?.passwordSet === true
                                                    ? 'برای نگه داشتن رمز فعلی خالی بگذارید'
                                                    : undefined
                                            }
                                            invalid={draftError !== ''}
                                            value={draft.password}
                                            onChange={(next) => edit({ password: next })}
                                        />
                                    </Field>
                                </div>

                                <div className="mt-5 flex flex-wrap gap-2">
                                    <Button
                                        type="submit"
                                        variant="primary"
                                        glyph={Save}
                                        busy={savingProxy}
                                        busyText="در حال ذخیره..."
                                    >
                                        ذخیره
                                    </Button>
                                    <Button
                                        glyph={Activity}
                                        busy={draftTest === null}
                                        busyText="در حال تست..."
                                        onClick={() => void testDraft()}
                                    >
                                        تست همین مقادیر
                                    </Button>
                                    <Button onClick={() => setDraft(null)}>انصراف</Button>
                                </div>
                                <p
                                    role="status"
                                    className="mt-3 flex flex-wrap items-center gap-1 text-caption"
                                >
                                    <TestResult result={draftTest} />
                                </p>
                            </form>
                        )}
                    </div>

                    <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
                        <p className="flex items-start gap-2 text-small">
                            <AlertTriangle
                                className="size-5 shrink-0 text-gold"
                                aria-hidden="true"
                            />
                            <span>
                                پشتیبان‌گیری یک نسخهٔ کامل از دیتابیس - شامل همهٔ کدهای فروش‌نرفته - را
                                به همین چت می‌فرستد. چتی را انتخاب کنید که فقط خودتان به آن دسترسی
                                دارید.
                            </span>
                        </p>

                        <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                                glyph={Send}
                                busy={testing}
                                busyText="در حال ارسال..."
                                disabled={!ready}
                                onClick={() => void sendTest()}
                            >
                                ارسال پیام آزمایشی
                            </Button>
                            <Button
                                glyph={DatabaseBackup}
                                busy={backingUp}
                                busyText="در حال ارسال..."
                                disabled={!ready}
                                onClick={() => void backupNow()}
                            >
                                پشتیبان‌گیری همین حالا
                            </Button>
                        </div>

                        {!ready && (
                            <p className="mt-3 text-caption text-muted">
                                اول توکن و شناسهٔ چت را ذخیره کنید.
                            </p>
                        )}
                    </div>
                </Async>
            </div>
        </section>
    );
}
