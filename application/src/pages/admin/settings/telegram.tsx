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
import {
    Activity,
    AlertTriangle,
    CircleCheck,
    CircleX,
    DatabaseBackup,
    Plus,
    Radio,
    Save,
    Send,
    Trash2
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import {
    DEFAULT_BACKUP_MINUTES,
    MAX_BACKUP_MINUTES,
    MIN_BACKUP_MINUTES,
    parseProxyLink,
    telegramProxy,
    type TelegramProxy,
    type TelegramProxyTest,
    type TelegramStatusView
} from '../../../../../server/src/contract/index.ts';
import { count } from '../../../lib/format.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

/** The server's own ceiling, repeated here so the button can say so before a request does. */
const MAX_PROXIES = 20;

/**
 * A proxy as the form holds it: text in every box, because that is what a box contains.
 * `index` is the row being changed, or null for one that is not in the list yet.
 */
interface ProxyDraft {
    index: number | null;
    link: string;
    server: string;
    port: string;
    secret: string;
}

/** What tells two rows apart. Also what a row's test result is filed under. */
function proxyId(proxy: TelegramProxy): string {
    return `${proxy.server}:${proxy.port}:${proxy.secret}`;
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
    const [formApiId, setFormApiId] = useState('');
    // Write-only, like the token: blank means "unchanged".
    const [formApiHash, setFormApiHash] = useState('');
    const [formMinutes, setFormMinutes] = useState('');

    const [draft, setDraft] = useState<ProxyDraft | null>(null);
    const [draftError, setDraftError] = useState('');
    const [savingProxy, setSavingProxy] = useState(false);
    // `null` while a test is in flight. A row that was never tested has no entry at all.
    const [tests, setTests] = useState<Record<string, TelegramProxyTest | null>>({});

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.telegram();
            setStatus(view);
            setFormChatId(view.chatId);
            setFormBase(view.baseUrl);
            setFormApiId(view.apiId);
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
                    telegramApiId: formApiId,
                    backupEveryMinutes: minutes,
                    // Absent, not empty: a blank token box must not switch the bot off.
                    telegramBotToken: formToken === '' ? undefined : formToken,
                    telegramApiHash: formApiHash === '' ? undefined : formApiHash
                }
            });
            setFormToken('');
            setFormApiHash('');
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
     * Writes the whole list, and nothing but the list. The view is patched in place rather
     * than re-read: `load` refills every box on the page, and somebody half way through
     * typing a new chat id should not lose it because they removed a proxy.
     */
    const saveProxies = async (next: TelegramProxy[], done: string): Promise<boolean> => {
        setSavingProxy(true);
        try {
            await client.admin.saveSettings({ input: { telegramProxies: next } });
            setStatus((current) => (current === null ? current : { ...current, proxies: next }));
            notify.success(done);
            return true;
        } catch (failure) {
            notify.error(failureText(failure, 'ذخیره نشد'));
            return false;
        } finally {
            setSavingProxy(false);
        }
    };

    const openDraft = (next: ProxyDraft): void => {
        setDraftError('');
        setDraft(next);
    };

    /** A pasted share link fills the three boxes under it. Anything else is left to be typed. */
    const pasteLink = (link: string): void => {
        if (draft === null) {
            return;
        }
        const parsed = parseProxyLink(link);
        setDraftError('');
        setDraft(
            parsed === null
                ? { ...draft, link }
                : {
                      ...draft,
                      link,
                      server: parsed.server,
                      port: String(parsed.port),
                      secret: parsed.secret
                  }
        );
    };

    const saveDraft = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        if (draft === null) {
            return;
        }

        // The same shape the server enforces, checked here first so the operator gets a
        // sentence beside the form rather than a rejected request.
        const parsed = telegramProxy.safeParse({
            server: draft.server,
            port: Number(draft.port),
            secret: draft.secret
        });
        if (!parsed.success) {
            setDraftError(
                'سرور، پورت یا کلید درست نیست. کلید باید همان secret لینک پراکسی MTProto باشد.'
            );
            return;
        }
        const taken = proxies.some(
            (proxy, index) => index !== draft.index && proxyId(proxy) === proxyId(parsed.data)
        );
        if (taken) {
            setDraftError('این پراکسی از قبل در فهرست هست.');
            return;
        }

        const saved =
            draft.index === null
                ? await saveProxies([...proxies, parsed.data], 'پراکسی اضافه شد')
                : await saveProxies(
                      proxies.map((proxy, index) => (index === draft.index ? parsed.data : proxy)),
                      'پراکسی ذخیره شد'
                  );
        if (saved) {
            setDraft(null);
        }
    };

    const removeProxy = async (index: number): Promise<void> => {
        const proxy = proxies[index];
        if (!confirm(`پراکسی ${proxy.server}:${proxy.port} از فهرست حذف شود؟`)) {
            return;
        }
        if (
            await saveProxies(
                proxies.filter((_, at) => at !== index),
                'پراکسی حذف شد'
            )
        ) {
            // The rows have moved up, so a form open on one of them is pointing at another.
            setDraft(null);
        }
    };

    const testProxy = async (proxy: TelegramProxy): Promise<void> => {
        const id = proxyId(proxy);
        setTests((current) => ({ ...current, [id]: null }));
        let result: TelegramProxyTest;
        try {
            result = await client.admin.testTelegramProxy({ input: proxy });
        } catch (failure) {
            result = { ok: false, reason: failureText(failure, 'تست انجام نشد'), ms: 0 };
        }
        setTests((current) => ({ ...current, [id]: result }));
    };

    const ready = status?.configured === true;

    // The list is ignored until the bot has what it needs to speak MTProto at all, and a
    // list that is silently ignored is worse than no list.
    const proxiesIdle =
        status !== null && proxies.length > 0 && (status.apiId === '' || !status.apiHashSet);

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

                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <Field
                                label="API ID"
                                htmlFor="telegram-api-id"
                                hint="از my.telegram.org می‌گیرید. فقط برای اتصال از راه پراکسی لازم است."
                            >
                                <TextInput
                                    id="telegram-api-id"
                                    latin
                                    inputMode="numeric"
                                    autoComplete="off"
                                    placeholder="1234567"
                                    value={formApiId}
                                    onChange={setFormApiId}
                                />
                            </Field>
                            <Field
                                label="API Hash"
                                htmlFor="telegram-api-hash"
                                hint="بعد از ذخیره دیگر نمایش داده نمی‌شود؛ برای نگه داشتن مقدار فعلی خالی بگذارید."
                            >
                                <TextInput
                                    id="telegram-api-hash"
                                    type="password"
                                    latin
                                    autoComplete="off"
                                    placeholder={
                                        status?.apiHashSet === true
                                            ? `${status.apiHashMasked} (برای تغییر بنویسید)`
                                            : 'تنظیم نشده'
                                    }
                                    value={formApiHash}
                                    onChange={setFormApiHash}
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
                            <h3 className="font-bold">پراکسی‌های MTProto</h3>
                            <Button
                                glyph={Plus}
                                size="sm"
                                className="ms-auto"
                                disabled={proxies.length >= MAX_PROXIES}
                                onClick={() =>
                                    openDraft({
                                        index: null,
                                        link: '',
                                        server: '',
                                        port: '',
                                        secret: ''
                                    })
                                }
                            >
                                پراکسی تازه
                            </Button>
                        </div>
                        <p className="mt-2 text-caption text-muted">
                            ربات از راه اولین پراکسی‌ای که جواب بدهد به تلگرام وصل می‌شود، به‌ترتیب
                            همین فهرست. اگر هیچ‌کدام کار نکند، آدرس API بالا آخرین گزینه است. فقط
                            پراکسی MTProto پذیرفته می‌شود؛ حداکثر {count(MAX_PROXIES)} پراکسی.
                        </p>

                        {proxiesIdle && (
                            <p className="mt-3 flex items-start gap-2 text-small">
                                <AlertTriangle
                                    className="size-5 shrink-0 text-gold"
                                    aria-hidden="true"
                                />
                                <span>
                                    تا وقتی API ID و API Hash در فرم بالا ذخیره نشده‌اند، این فهرست
                                    استفاده نمی‌شود و تست هم جواب نمی‌دهد.
                                </span>
                            </p>
                        )}

                        {proxies.length === 0 ? (
                            <p className="mt-4 text-small text-muted">
                                هنوز پراکسی‌ای اضافه نشده است. ربات مستقیم به آدرس API وصل می‌شود.
                            </p>
                        ) : (
                            <ol className="mt-4 grid gap-3">
                                {proxies.map((proxy, index) => {
                                    const id = proxyId(proxy);
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
                                                    {proxy.server}:{proxy.port}
                                                </span>
                                                {/* Always in the tree, so a result that
                                                    arrives later is announced rather than
                                                    only drawn. Said in words and an icon,
                                                    not in colour alone. */}
                                                <span
                                                    role="status"
                                                    className="flex items-center gap-1 text-caption"
                                                >
                                                    {result?.ok === true && (
                                                        <>
                                                            <CircleCheck
                                                                className="size-4 shrink-0 text-firouze"
                                                                aria-hidden="true"
                                                            />
                                                            <span className="font-bold text-firouze">
                                                                سالم، {count(result.ms)} میلی‌ثانیه
                                                            </span>
                                                        </>
                                                    )}
                                                    {result?.ok === false && (
                                                        <>
                                                            <CircleX
                                                                className="size-4 shrink-0 text-danger"
                                                                aria-hidden="true"
                                                            />
                                                            <span className="font-bold text-danger">
                                                                ناموفق:
                                                            </span>
                                                            <span
                                                                dir="ltr"
                                                                className="latin break-all text-danger"
                                                            >
                                                                {result.reason}
                                                            </span>
                                                        </>
                                                    )}
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
                                                            index,
                                                            link: '',
                                                            server: proxy.server,
                                                            port: String(proxy.port),
                                                            secret: proxy.secret
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
                                    label="لینک پراکسی"
                                    htmlFor="proxy-link"
                                    className="mt-4"
                                    hint="لینک tg://proxy یا t.me/proxy را اینجا بچسبانید تا سه خانهٔ پایین پر شود. یا آن‌ها را دستی بنویسید."
                                >
                                    <TextInput
                                        id="proxy-link"
                                        latin
                                        tone="surface"
                                        inputMode="url"
                                        autoComplete="off"
                                        placeholder="tg://proxy?server=...&port=...&secret=..."
                                        value={draft.link}
                                        onChange={pasteLink}
                                    />
                                </Field>

                                <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_8rem]">
                                    <Field label="سرور" htmlFor="proxy-server">
                                        <TextInput
                                            id="proxy-server"
                                            latin
                                            tone="surface"
                                            autoComplete="off"
                                            placeholder="proxy.example.com"
                                            invalid={draftError !== ''}
                                            value={draft.server}
                                            onChange={(next) => {
                                                setDraftError('');
                                                setDraft({ ...draft, server: next });
                                            }}
                                        />
                                    </Field>
                                    <Field label="پورت" htmlFor="proxy-port">
                                        <TextInput
                                            id="proxy-port"
                                            latin
                                            tone="surface"
                                            inputMode="numeric"
                                            autoComplete="off"
                                            placeholder="443"
                                            invalid={draftError !== ''}
                                            value={draft.port}
                                            onChange={(next) => {
                                                setDraftError('');
                                                setDraft({ ...draft, port: next });
                                            }}
                                        />
                                    </Field>
                                </div>

                                <Field
                                    label="کلید (secret)"
                                    htmlFor="proxy-secret"
                                    className="mt-4"
                                    error={draftError}
                                >
                                    <TextInput
                                        id="proxy-secret"
                                        latin
                                        tone="surface"
                                        autoComplete="off"
                                        invalid={draftError !== ''}
                                        value={draft.secret}
                                        onChange={(next) => {
                                            setDraftError('');
                                            setDraft({ ...draft, secret: next });
                                        }}
                                    />
                                </Field>

                                <div className="mt-5 flex gap-2">
                                    <Button
                                        type="submit"
                                        variant="primary"
                                        glyph={Save}
                                        busy={savingProxy}
                                        busyText="در حال ذخیره..."
                                    >
                                        ذخیره
                                    </Button>
                                    <Button onClick={() => setDraft(null)}>انصراف</Button>
                                </div>
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
