// The shop's own name, on its own.
//
// IT IS HERE BECAUSE IT BELONGS TO NEITHER NEIGHBOUR. The name is the browser tab, the page
// header, the footer, the subject line of the gift-code email AND the transaction description
// on the gateway - so it cannot sit inside the payment panel without the mail settings
// depending on a field in it, or inside the mail panel without the reverse. One field, one
// job, one card.
//
// It is the only setting on this tab that changes something the BUYER sees on every page,
// which is why saving it tells the storefront to re-read rather than waiting for a reload.
import { Save, Store } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import { useToasts } from '../../../ui/toast.tsx';
import { useCatalog } from '../../../lib/catalog.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

export default function ShopSettings(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();
    const catalog = useCatalog();

    const [loaded, setLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const [formAppName, setFormAppName] = useState('');

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.settings();
            setFormAppName(view.appName);
            setLoaded(true);
        } catch (failure) {
            setError(failureText(failure, 'تنظیمات خوانده نشد'));
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

        // Nothing is saved before something is read - see the note in email.tsx. Posting the
        // empty box this form starts with would rename the shop to nothing.
        if (!loaded) {
            notify.error('تنظیمات هنوز خوانده نشده است. صفحه را تازه کنید.');
            return;
        }
        if (formAppName.trim() === '') {
            notify.error('نام فروشگاه را وارد کنید');
            return;
        }

        setSaving(true);
        try {
            // ONLY this panel's field is sent. An absent field keeps its value, so a save here
            // cannot touch the gateway or the mail server - which is the point of the split.
            await client.admin.saveSettings({ input: { appName: formAppName } });
            // The name is on every page of the shop, so it is told to re-read rather than left
            // showing the old one until somebody reloads.
            void catalog.load();
            notify.success('نام فروشگاه ذخیره شد');
        } catch (failure) {
            notify.error(failureText(failure, 'ذخیره نشد'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="mt-section">
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <Store className="size-5 text-firouze" aria-hidden="true" />
                فروشگاه
            </h2>

            <div className="mt-4">
                <Async
                    loading={loading || !loaded}
                    error={error}
                    onRetry={() => void load()}
                    skeleton={
                        <div className="anim-pulse h-32 rounded-2xl border border-line bg-surface"></div>
                    }
                >
                    <form
                        className="rounded-2xl border border-line bg-surface p-5"
                        noValidate
                        onSubmit={(event) => void save(event)}
                    >
                        <Field
                            label="نام فروشگاه"
                            htmlFor="app-name"
                            hint="روی عنوان مرورگر، سربرگ صفحه‌ها، پانویس، موضوع ایمیل کد، و توضیح تراکنش در درگاه دیده می‌شود."
                        >
                            <TextInput
                                id="app-name"
                                placeholder="گاردین سرویس"
                                value={formAppName}
                                onChange={setFormAppName}
                            />
                        </Field>

                        <Button
                            type="submit"
                            variant="primary"
                            glyph={Save}
                            className="mt-5"
                            busy={saving}
                            busyText="در حال ذخیره..."
                        >
                            ذخیره نام
                        </Button>
                    </form>
                </Async>
            </div>
        </section>
    );
}
