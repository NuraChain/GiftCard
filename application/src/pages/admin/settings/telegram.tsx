// The operations bot: a ping when something sells, and the database once an hour.
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
import { AlertTriangle, DatabaseBackup, Save, Send, Radio } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { TelegramStatusView } from '../../../../../server/src/contract/index.ts';
import { count } from '../../../lib/format.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

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

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.telegram();
            setStatus(view);
            setFormChatId(view.chatId);
            setFormBase(view.baseUrl);
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
        setSaving(true);
        try {
            await client.admin.saveSettings({
                input: {
                    telegramChatId: formChatId,
                    telegramBase: formBase,
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

    const ready = status?.configured === true;

    return (
        <section className="mt-section">
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <Radio className="size-5 text-firouze" aria-hidden="true" />
                ربات تلگرام
            </h2>
            <p className="mt-2 text-small text-muted">
                با هر فروش یک پیام به این چت می‌رسد، و هر {count(status?.backupEveryMinutes ?? 60)}{' '}
                دقیقه یک نسخهٔ پشتیبان از دیتابیس فرستاده می‌شود. کد گیفت کارت هیچ‌وقت در پیام فروش
                نمی‌آید.
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
                                hint="شناسهٔ عددی کاربر یا گروه، یا نام کانال مثل ‎@guardianops"
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
                                <dd>{count(status?.backupEveryMinutes ?? 60)} دقیقه</dd>
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
