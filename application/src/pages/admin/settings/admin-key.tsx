// Rotating the console credential.
//
// The current key is required even though a session is already open: a session proves
// someone WAS the admin at sign-in, and replacing the credential should prove they still
// are. Rotation kills every open session including this one, so success ends by sending the
// operator back to the lock screen - that is the honest consequence, not a bug.
import { KeyRound } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';

/** The generator's alphabet, matching the server's ADMIN_KEY_PATTERN: no I, O, 0 or 1. */
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export default function AdminKeySettings(): ReactNode
{
    const notify = useToasts();

    const [currentKey, setCurrentKey] = useState('');
    const [newKey, setNewKey] = useState('');
    const [rotating, setRotating] = useState(false);

    const rotate = async (event: FormEvent): Promise<void> =>
    {
        event.preventDefault();
        setRotating(true);
        try
        {
            await client.admin.rotateKey({ input: { currentKey, newKey } });
            // Every session died with the old key, including this one. Sending the operator
            // back to the lock screen is the honest consequence, not a bug.
            notify.success('کلید عوض شد. با کلید تازه دوباره وارد شوید.');
            window.location.assign('/admin');
        }
        catch (failure)
        {
            notify.error(failureText(failure, 'چرخش کلید انجام نشد'));
            setRotating(false);
        }
    };

    const generateKey = (): void =>
    {
        setNewKey([...crypto.getRandomValues(new Uint8Array(16))]
            .map((byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length])
            .join('')
            .replace(/(.{4})(?=.)/g, '$1-'));
    };

    return (
        <section className="mt-section">
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <KeyRound className="size-5 text-firouze" aria-hidden="true"/>
                کلید مدیریت
            </h2>
            <p className="mt-2 text-small text-muted">
                کلید تازه جای کلید فعلی را می‌گیرد و همهٔ نشست‌های باز - از جمله همین یکی - بسته می‌شوند.
                کلید فقط به شکل درهم‌سازی‌شده ذخیره می‌شود، پس اگر گمش کنید بازیابی نمی‌شود.
            </p>

            <form className="mt-4 rounded-2xl border border-line bg-surface p-5" noValidate onSubmit={ (event) => void rotate(event) }>
                <Field label="کلید فعلی" htmlFor="current-key">
                    <TextInput
                        id="current-key"
                        type="password"
                        latin
                        autoComplete="off"
                        className="tracking-wider"
                        placeholder="XXXX-XXXX-XXXX-XXXX"
                        value={ currentKey }
                        onChange={ setCurrentKey }
                    />
                </Field>

                <Field label="کلید تازه" htmlFor="new-key" className="mt-4" hint="پیش از چرخش، کلید تازه را جایی امن ذخیره کنید.">
                    <div className="flex gap-2">
                        <TextInput
                            id="new-key"
                            latin
                            autoComplete="off"
                            className="min-w-0 tracking-wider"
                            placeholder="XXXX-XXXX-XXXX-XXXX"
                            value={ newKey }
                            onChange={ setNewKey }
                        />
                        <Button className="shrink-0" onClick={ generateKey }>تولید</Button>
                    </div>
                </Field>

                <Button
                    type="submit"
                    variant="danger"
                    className="mt-5"
                    busy={ rotating }
                    busyText="در حال چرخش..."
                    disabled={ currentKey.length !== 19 || newKey.length !== 19 }
                >
                    چرخش کلید
                </Button>
            </form>
        </section>
    );
}
