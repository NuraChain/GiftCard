// One purchasable tier, and the whole purchase inside it.
//
// The card used to show a sample gift code and a "choose" button that scrolled the reader
// down to a single form at the foot of the page. The form is IN THE CARD now: the buyer
// types their number on the card they are buying, so the amount is never a separate choice
// that can drift out of step with what they are looking at, and the journey is one place
// instead of two ends of a scroll.
//
// THE CONFIRM STEP catches a mistyped mobile number before payment. Reading the number back
// costs one tap and catches the typo before the money moves.
//
// THE PRICE IS NOW A MOVING TARGET, and this file is where that is made safe for the buyer.
// Card prices are derived from the tether rate the console set, so the figure on screen has a shelf
// life. Pressing «ادامه» PINS the number the buyer agreed to, and that pinned number is sent
// with the purchase. The server recomputes the price from its own rate and refuses if the two
// disagree - so a rate that moves mid-purchase produces a re-quote the buyer has to accept,
// never a silent charge for a different sum. The pinned figure is a promise about what was
// displayed; it is never the amount, and the server treats it as an assertion to check.
//
// A CARD WITH NO PRICE IS NOT A CARD WITH A ZERO. When no tether rate is set the server
// sends a null and this refuses to be bought, in the same words the ticker uses. Inventing a
// last-known price here would defeat the entire point of the server refusing a stale one.
//
// The three cards are NOT interchangeable boxes: the recommended one carries the firouze
// treatment, so the hierarchy comes from colour and content rather than a scale transform
// and a "popular" sticker.
//
// The amount is an LTR ISLAND inside an RTL block: only the inner span carries dir, so the
// characters read "$25" while the block still aligns to the RTL start. Putting dir on the
// block itself silently flips what `text-start` means.
//
// THE ENGLISH SHOP'S CARD IS A DIFFERENT PURCHASE, and is its own component at the bottom of
// this file. It asks for an email, sells at the face value in dollars - so there is no moving
// price and nothing above about pinning a quote applies - and pays through Plisio.
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ApiError, client, failureText } from '../lib/api.ts';
import { purchaseEnFormInput, purchaseFormInput } from '../../../server/src/contract/index.ts';
import { useCatalog, type CatalogTier } from '../lib/catalog.tsx';
import { count, toman, usd } from '../lib/format.ts';
import { shopOf, useDollarCopy, useLang, type IntlLang } from '../lib/lang.ts';
import { rememberReceipt } from '../lib/pending-receipt.ts';
import { useForm } from '../lib/use-form.ts';
import Button from '../ui/button.tsx';
import Field from '../ui/field.tsx';
import TextInput from '../ui/text-input.tsx';

/**
 * Says in the browser console why a payment did not start.
 *
 * FOR WHOEVER RUNS THE SHOP, NOT FOR THE BUYER - the buyer has the sentence on the card. A
 * checkout that will not open is the shop being closed, and "it does nothing" is all anybody
 * can report about it without this.
 *
 * The gateway's own account of the refusal arrives ONLY when this browser is signed in to the
 * console; the server withholds it from everybody else. So an empty one is followed by where
 * to get it, rather than left as a blank to be puzzled over.
 */
function logFailure(error: unknown): void {
    /* oxlint-disable no-console -- the console IS the destination: see above. */
    if (!(error instanceof ApiError)) {
        console.error('[checkout] the request to start a payment never got an answer:', error);
        return;
    }

    console.error('[checkout] could not start the payment:', {
        status: error.status,
        code: error.code,
        message: error.message,
        reason: error.reason === '' ? '(not sent)' : error.reason
    });

    if (error.code === 'gateway-unavailable' && error.reason === '') {
        console.info(
            '[checkout] the payment gateway refused. Sign in at /admin in THIS browser and try ' +
                "again: the gateway's own reason is shown here only to a signed-in operator."
        );
    } else if (error.code === 'error') {
        console.info(
            "[checkout] that answer did not come from this shop's API - something in front of " +
                'it (a proxy, a CDN) replied instead, or the API is not running.'
        );
    }
    /* oxlint-enable no-console */
}

/** The card the reader's shop sells: Toman and a mobile number, or dollars and an email. */
export default function GiftCard({ tier }: { tier: CatalogTier }): ReactNode {
    return shopOf(useLang()) === 'dollar' ? <DollarCard tier={tier} /> : <TomanCard tier={tier} />;
}

function TomanCard({ tier }: { tier: CatalogTier }): ReactNode {
    const catalog = useCatalog();
    const [step, setStep] = useState<'phone' | 'confirm'>('phone');
    const [paying, setPaying] = useState(false);
    const [failure, setFailure] = useState('');

    // The price the buyer agreed to when they pressed «ادامه». Null means "take the live
    // one" - which is the state after a re-quote, so the fresh figure is what shows.
    const [quoted, setQuoted] = useState<number | null>(null);
    const [repriced, setRepriced] = useState(false);

    const form = useForm(purchaseFormInput, { phone: '' });

    // `?? null` throughout: an older server mid-deploy answers without a `toman` at all, and
    // `undefined` must read as "no price" rather than slipping past a `=== null` check and
    // being rendered - or worse, sent - as a price.
    const listed = tier.toman ?? null;
    const price = quoted ?? listed;
    const soldOut = tier.available === 0;
    const unpriced = listed === null;
    const buyable = !soldOut && !unpriced;
    const inputId = `phone-${tier.amount}`;

    const pay = async (): Promise<void> => {
        if (price === null) {
            return;
        }
        setPaying(true);
        setFailure('');
        setRepriced(false);
        try {
            const opened = await client.pay.start({
                input: {
                    amount: tier.amount,
                    phone: form.values.phone,
                    // What this card was showing. The server charges its own figure and uses
                    // this only to check the two still agree.
                    quotedToman: price
                }
            });
            // Leaving the page is the success case: the gateway owns the next screen.
            window.location.assign(opened.payUrl);
        } catch (error) {
            setPaying(false);

            // The rate moved between the quote and the button. Not a failure and not worth an
            // error voice: the buyer is shown the new number and asked again, which is the
            // whole reason the server refused rather than charging it.
            if (error instanceof ApiError && error.code === 'price-changed') {
                await catalog.refresh();
                setQuoted(null);
                setRepriced(true);
                return;
            }

            logFailure(error);
            setFailure(
                failureText(
                    error,
                    'شروع پرداخت ممکن نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.'
                )
            );
        }
    };

    return (
        <article
            className={`flex flex-col rounded-2xl border bg-surface p-5 sm:p-6 ${
                tier.recommended
                    ? 'border-firouze shadow-[0_1px_24px_-8px_var(--firouze)]'
                    : 'border-line'
            }`}
        >
            <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-bold">{tier.title}</h3>
                {tier.recommended && (
                    <span className="rounded-full bg-firouze/15 px-2.5 py-0.5 text-caption font-bold text-firouze">
                        انتخاب بیشتر کاربران
                    </span>
                )}
            </div>

            <p className="mt-3 text-start text-3xl font-bold sm:text-4xl">
                <span dir="ltr" className="latin inline-block">
                    ${tier.amount}
                </span>
            </p>

            <p className="mt-1 min-h-5 text-small text-muted">
                {price === null ? 'فعلاً در دسترس نیست' : `${toman(price)} تومان`}
            </p>

            <p className="mt-3 text-small text-muted">{tier.blurb}</p>

            {/* `mt-auto` pins the purchase to the bottom of the card. The blurbs are
                different lengths, so without it the inputs sit at three different levels
                across a row and the grid reads as broken rather than as a set. */}
            <div className="mt-auto pt-4">
                <p className="min-h-5 text-caption">
                    {soldOut ? (
                        <span className="text-muted">فعلاً موجود نیست</span>
                    ) : (
                        <span className="text-firouze">{count(tier.available)} کد آماده تحویل</span>
                    )}
                </p>

                {step === 'phone' ? (
                    <form
                        className="mt-3"
                        noValidate
                        onSubmit={form.handleSubmit(() => {
                            setFailure('');
                            setRepriced(false);
                            // PIN the figure on screen. From here to the gateway, this is the
                            // number the buyer agreed to and the one the server is held to.
                            setQuoted(listed);
                            setStep('confirm');
                        })}
                    >
                        <Field
                            label="شماره موبایل"
                            htmlFor={inputId}
                            error={form.errorFor('phone') === '' ? '' : 'شماره موبایل معتبر نیست.'}
                            hint={
                                form.errorFor('phone') === ''
                                    ? 'کد خرید به همین شماره پیامک می‌شود.'
                                    : undefined
                            }
                        >
                            <TextInput
                                id={inputId}
                                type="tel"
                                latin
                                inputMode="tel"
                                autoComplete="tel"
                                placeholder="09123456789"
                                disabled={!buyable}
                                invalid={form.errorFor('phone') !== ''}
                                value={form.values.phone}
                                onChange={(value) => form.set('phone', value)}
                            />
                        </Field>

                        <Button
                            type="submit"
                            variant={tier.recommended ? 'primary' : 'outline'}
                            full
                            className="mt-4"
                            disabled={!buyable}
                        >
                            {soldOut ? 'ناموجود' : unpriced ? 'قیمت در دسترس نیست' : 'ادامه'}
                        </Button>
                    </form>
                ) : (
                    <div className="mt-3">
                        <div className="rounded-xl border border-line bg-paper p-4">
                            <p className="text-caption text-muted">شماره موبایل</p>
                            <p dir="ltr" className="latin mt-1 text-start text-lg font-semibold">
                                {form.values.phone}
                            </p>
                            <button
                                type="button"
                                className="mt-2 min-h-tap text-caption font-bold text-firouze hover:underline"
                                onClick={() => setStep('phone')}
                            >
                                ویرایش شماره
                            </button>
                        </div>

                        <dl className="mt-4 grid gap-2 text-small">
                            <div className="flex justify-between gap-2">
                                <dt className="shrink-0 text-muted">مبلغ قابل پرداخت</dt>
                                <dd className="min-w-0 text-end font-bold">
                                    {price === null ? '—' : `${toman(price)} تومان`}
                                </dd>
                            </div>
                        </dl>

                        {repriced && (
                            <p className="mt-4 flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 p-3 text-caption">
                                <TriangleAlert
                                    className="size-4 shrink-0 text-gold"
                                    aria-hidden="true"
                                />
                                <span>
                                    قیمت این کارت به‌روز شد. پولی از حساب شما کم نشده است. اگر مبلغ
                                    تازه را قبول دارید دوباره پرداخت را بزنید.
                                </span>
                            </p>
                        )}

                        {failure !== '' && <p className="mt-4 text-small text-danger">{failure}</p>}

                        <Button
                            variant="primary"
                            full
                            trailing={ArrowRight}
                            className="mt-4"
                            busy={paying}
                            busyText="در حال انتقال به درگاه..."
                            disabled={!buyable || price === null}
                            onClick={() => void pay()}
                        >
                            {price === null ? 'قیمت در دسترس نیست' : `پرداخت ${toman(price)} تومان`}
                        </Button>

                        <p className="mt-3 text-caption text-muted">
                            پرداخت روی درگاه پرداخت اینترنتی انجام می‌شود. اطلاعات کارت بانکی شما به
                            سرور ما نمی‌رسد.
                        </p>
                    </div>
                )}
            </div>
        </article>
    );
}

/**
 * The English shop's card: an email, the face value in dollars, and Plisio.
 *
 * It keeps the Persian card's shape - the purchase inside the card, a confirm step that reads
 * the address back - because a mistyped email is exactly as expensive as a mistyped mobile:
 * the code goes somewhere nobody reads.
 *
 * THE RECEIPT TOKEN IS REMEMBERED BEFORE THE BUYER LEAVES. Plisio sends every buyer back to the
 * same address, so this tab is the only thing that knows which order it is waiting for - see
 * lib/pending-receipt.ts.
 */
interface DollarCopy {
    /** A card with no English title of its own: `$10.00 gift card`. */
    untitled: (price: string) => string;
    popular: string;
    unavailable: string;
    paidInCrypto: (price: string) => string;
    outOfStock: string;
    ready: (n: string) => string;
    email: string;
    invalidEmail: string;
    emailHint: string;
    notAvailable: string;
    proceed: string;
    changeEmail: string;
    total: string;
    opening: string;
    pay: (price: string) => string;
    note: string;
    failed: string;
    // The server's own refusals are worded in English only, so each language says them here.
    soldOut: string;
    closed: string;
}

const DOLLAR_COPY: Record<IntlLang, DollarCopy> = {
    en: {
        untitled: (price) => `${price} gift card`,
        popular: 'Most popular',
        unavailable: 'Not available right now',
        paidInCrypto: (price) => `${price}, paid in crypto`,
        outOfStock: 'Out of stock',
        ready: (n) => `${n} ready to deliver`,
        email: 'Email',
        invalidEmail: 'Enter a valid email address.',
        emailHint: 'Your code is emailed to this address.',
        notAvailable: 'Not available',
        proceed: 'Continue',
        changeEmail: 'Change email',
        total: 'Total',
        opening: 'Opening checkout...',
        pay: (price) => `Pay ${price}`,
        note: "You pay in crypto on Plisio's checkout page. Your wallet keys never reach our server.",
        failed: 'The payment could not be started. Check your connection and try again.',
        soldOut: 'This card cannot be bought right now. Please choose another one.',
        closed: 'Payments are not available right now. Please try again later.'
    },
    ar: {
        untitled: (price) => `بطاقة هدايا بقيمة ${price}`,
        popular: 'الأكثر طلبًا',
        unavailable: 'غير متاحة حاليًا',
        paidInCrypto: (price) => `${price}، تُدفع بالعملات الرقمية`,
        outOfStock: 'نفدت الكمية',
        ready: (n) => `${n} جاهزة للتسليم`,
        email: 'البريد الإلكتروني',
        invalidEmail: 'أدخل بريدًا إلكترونيًا صحيحًا.',
        emailHint: 'سيُرسل الرمز إلى هذا البريد الإلكتروني.',
        notAvailable: 'غير متاحة',
        proceed: 'متابعة',
        changeEmail: 'تغيير البريد الإلكتروني',
        total: 'الإجمالي',
        opening: 'جارٍ فتح صفحة الدفع...',
        pay: (price) => `ادفع ${price}`,
        note: 'تدفع بالعملات الرقمية على صفحة الدفع في Plisio. مفاتيح محفظتك لا تصل إلى خادمنا أبدًا.',
        failed: 'تعذّر بدء الدفع. تحقّق من اتصالك وحاول مرة أخرى.',
        soldOut: 'لا يمكن شراء هذه البطاقة حاليًا. يُرجى اختيار بطاقة أخرى.',
        closed: 'الدفع غير متاح حاليًا. يُرجى المحاولة لاحقًا.'
    },
    es: {
        untitled: (price) => `Tarjeta de regalo de ${price}`,
        popular: 'La más elegida',
        unavailable: 'No disponible por ahora',
        paidInCrypto: (price) => `${price}, pago con criptomonedas`,
        outOfStock: 'Agotada',
        ready: (n) => `${n} listas para entregar`,
        email: 'Correo electrónico',
        invalidEmail: 'Introduce un correo electrónico válido.',
        emailHint: 'Te enviaremos el código a esta dirección.',
        notAvailable: 'No disponible',
        proceed: 'Continuar',
        changeEmail: 'Cambiar correo',
        total: 'Total',
        opening: 'Abriendo el pago...',
        pay: (price) => `Pagar ${price}`,
        note: 'Pagas con criptomonedas en la página de pago de Plisio. Las claves de tu billetera nunca llegan a nuestro servidor.',
        failed: 'No se pudo iniciar el pago. Revisa tu conexión e inténtalo de nuevo.',
        soldOut: 'Esta tarjeta no se puede comprar ahora. Elige otra, por favor.',
        closed: 'Los pagos no están disponibles en este momento. Inténtalo más tarde.'
    },
    pt: {
        untitled: (price) => `Cartão-presente de ${price}`,
        popular: 'Mais escolhido',
        unavailable: 'Indisponível no momento',
        paidInCrypto: (price) => `${price}, pago em cripto`,
        outOfStock: 'Esgotado',
        ready: (n) => `${n} prontos para entrega`,
        email: 'E-mail',
        invalidEmail: 'Digite um e-mail válido.',
        emailHint: 'O código será enviado para este e-mail.',
        notAvailable: 'Indisponível',
        proceed: 'Continuar',
        changeEmail: 'Alterar e-mail',
        total: 'Total',
        opening: 'Abrindo o pagamento...',
        pay: (price) => `Pagar ${price}`,
        note: 'Você paga em cripto na página de pagamento da Plisio. As chaves da sua carteira nunca chegam ao nosso servidor.',
        failed: 'Não foi possível iniciar o pagamento. Verifique sua conexão e tente novamente.',
        soldOut: 'Este cartão não pode ser comprado agora. Escolha outro, por favor.',
        closed: 'Os pagamentos não estão disponíveis no momento. Tente novamente mais tarde.'
    },
    hi: {
        untitled: (price) => `${price} का गिफ़्ट कार्ड`,
        popular: 'सबसे लोकप्रिय',
        unavailable: 'अभी उपलब्ध नहीं',
        paidInCrypto: (price) => `${price}, क्रिप्टो में भुगतान`,
        outOfStock: 'स्टॉक में नहीं',
        ready: (n) => `${n} डिलीवरी के लिए तैयार`,
        email: 'ईमेल',
        invalidEmail: 'कृपया मान्य ईमेल पता दर्ज करें।',
        emailHint: 'आपका कोड इसी पते पर ईमेल किया जाएगा।',
        notAvailable: 'उपलब्ध नहीं',
        proceed: 'आगे बढ़ें',
        changeEmail: 'ईमेल बदलें',
        total: 'कुल',
        opening: 'भुगतान पेज खुल रहा है...',
        pay: (price) => `${price} का भुगतान करें`,
        note: 'आप Plisio के भुगतान पेज पर क्रिप्टो में भुगतान करते हैं। आपके वॉलेट की कुंजियाँ कभी हमारे सर्वर तक नहीं पहुँचतीं।',
        failed: 'भुगतान शुरू नहीं हो सका। अपना कनेक्शन जाँचें और फिर से कोशिश करें।',
        soldOut: 'यह कार्ड अभी खरीदा नहीं जा सकता। कृपया कोई दूसरा कार्ड चुनें।',
        closed: 'भुगतान अभी उपलब्ध नहीं है। कृपया बाद में फिर से कोशिश करें।'
    },
    zh: {
        untitled: (price) => `${price} 礼品卡`,
        popular: '最受欢迎',
        unavailable: '暂不可购买',
        paidInCrypto: (price) => `${price}，使用加密货币支付`,
        outOfStock: '已售罄',
        ready: (n) => `${n} 张可立即发货`,
        email: '电子邮箱',
        invalidEmail: '请输入有效的电子邮箱地址。',
        emailHint: '兑换码将发送到此邮箱。',
        notAvailable: '暂不可用',
        proceed: '继续',
        changeEmail: '更改邮箱',
        total: '合计',
        opening: '正在打开支付页面...',
        pay: (price) => `支付 ${price}`,
        note: '您将在 Plisio 的支付页面使用加密货币付款。您的钱包密钥绝不会经过我们的服务器。',
        failed: '无法发起支付。请检查网络连接后重试。',
        soldOut: '此卡暂时无法购买，请选择其他卡。',
        closed: '暂时无法付款，请稍后再试。'
    },
    ru: {
        untitled: (price) => `Подарочная карта на ${price}`,
        popular: 'Самая популярная',
        unavailable: 'Сейчас недоступна',
        paidInCrypto: (price) => `${price}, оплата криптовалютой`,
        outOfStock: 'Нет в наличии',
        ready: (n) => `Готово к выдаче: ${n}`,
        email: 'Электронная почта',
        invalidEmail: 'Введите корректный адрес электронной почты.',
        emailHint: 'Код придёт на этот адрес.',
        notAvailable: 'Недоступно',
        proceed: 'Продолжить',
        changeEmail: 'Изменить адрес',
        total: 'Итого',
        opening: 'Открываем страницу оплаты...',
        pay: (price) => `Оплатить ${price}`,
        note: 'Оплата криптовалютой проходит на странице Plisio. Ключи вашего кошелька никогда не попадают на наш сервер.',
        failed: 'Не удалось начать оплату. Проверьте подключение и попробуйте снова.',
        soldOut: 'Эту карту сейчас нельзя купить. Пожалуйста, выберите другую.',
        closed: 'Оплата сейчас недоступна. Пожалуйста, попробуйте позже.'
    },
    fr: {
        untitled: (price) => `Carte cadeau de ${price}`,
        popular: 'La plus choisie',
        unavailable: 'Indisponible pour le moment',
        paidInCrypto: (price) => `${price}, payé en cryptomonnaie`,
        outOfStock: 'En rupture de stock',
        ready: (n) => `${n} prêtes à être livrées`,
        email: 'E-mail',
        invalidEmail: 'Saisissez une adresse e-mail valide.',
        emailHint: 'Votre code sera envoyé à cette adresse.',
        notAvailable: 'Indisponible',
        proceed: 'Continuer',
        changeEmail: "Modifier l'e-mail",
        total: 'Total',
        opening: 'Ouverture du paiement...',
        pay: (price) => `Payer ${price}`,
        note: 'Vous payez en cryptomonnaie sur la page de paiement de Plisio. Les clés de votre portefeuille ne transitent jamais par notre serveur.',
        failed: 'Impossible de lancer le paiement. Vérifiez votre connexion et réessayez.',
        soldOut: 'Cette carte ne peut pas être achetée pour le moment. Choisissez-en une autre.',
        closed: 'Les paiements sont indisponibles pour le moment. Réessayez plus tard.'
    },
    tr: {
        untitled: (price) => `${price} hediye kartı`,
        popular: 'En çok tercih edilen',
        unavailable: 'Şu anda satışta değil',
        paidInCrypto: (price) => `${price}, kripto ile ödenir`,
        outOfStock: 'Stokta yok',
        ready: (n) => `${n} adet teslimata hazır`,
        email: 'E-posta',
        invalidEmail: 'Geçerli bir e-posta adresi girin.',
        emailHint: 'Kodunuz bu adrese e-postayla gönderilir.',
        notAvailable: 'Kullanılamıyor',
        proceed: 'Devam et',
        changeEmail: 'E-postayı değiştir',
        total: 'Toplam',
        opening: 'Ödeme sayfası açılıyor...',
        pay: (price) => `${price} öde`,
        note: "Ödemeyi Plisio'nun ödeme sayfasında kripto ile yaparsınız. Cüzdan anahtarlarınız sunucumuza asla ulaşmaz.",
        failed: 'Ödeme başlatılamadı. Bağlantınızı kontrol edip tekrar deneyin.',
        soldOut: 'Bu kart şu anda satın alınamıyor. Lütfen başka bir kart seçin.',
        closed: 'Ödemeler şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.'
    }
};

function DollarCard({ tier }: { tier: CatalogTier }): ReactNode {
    const catalog = useCatalog();
    const lang = useLang();
    const t = useDollarCopy(DOLLAR_COPY);
    const price = usd(tier.amount, lang);
    const [step, setStep] = useState<'email' | 'confirm'>('email');
    const [paying, setPaying] = useState(false);
    const [failure, setFailure] = useState('');

    const form = useForm(purchaseEnFormInput, { email: '' });

    const soldOut = tier.available === 0;
    const closed = !catalog.englishOpen;
    const buyable = !soldOut && !closed;
    const inputId = `email-${tier.amount}`;

    // `?? ''` for a server mid-deploy that has not learnt the English copy yet.
    const title = (tier.titleEn ?? '') === '' ? t.untitled(price) : tier.titleEn;
    const blurb = tier.blurbEn ?? '';

    const pay = async (): Promise<void> => {
        setPaying(true);
        setFailure('');
        try {
            const opened = await client.pay.startEn({
                input: {
                    amount: tier.amount,
                    email: form.values.email,
                    // Which page Plisio sends the buyer back to.
                    lang: lang === 'fa' ? 'en' : lang
                }
            });
            rememberReceipt(opened.receipt);
            // Leaving the page is the success case: Plisio owns the next screen.
            window.location.assign(opened.payUrl);
        } catch (error) {
            setPaying(false);
            logFailure(error);
            // The checkout's own refusals - a 409 (sold out) or a 503 (Plisio closed) - get
            // their own sentence in the reader's language; the server words them in English
            // only. Anything else gets the general one: a throttle, a proxy's page, a dropped
            // connection, and a 422, whose headline is the shared validator's Persian one (the
            // form has already shown the field's message before it got this far).
            const status = error instanceof ApiError ? error.status : 0;
            setFailure(status === 409 ? t.soldOut : status === 503 ? t.closed : t.failed);
        }
    };

    return (
        <article
            className={`flex flex-col rounded-2xl border bg-surface p-5 sm:p-6 ${
                tier.recommended
                    ? 'border-firouze shadow-[0_1px_24px_-8px_var(--firouze)]'
                    : 'border-line'
            }`}
        >
            <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-bold">{title}</h3>
                {tier.recommended && (
                    <span className="rounded-full bg-firouze/15 px-2.5 py-0.5 text-caption font-bold text-firouze">
                        {t.popular}
                    </span>
                )}
            </div>

            {/* An LTR island, as on the Toman card: on the Arabic page the block is RTL. */}
            <p className="mt-3 text-start text-3xl font-bold sm:text-4xl">
                <span dir="ltr" className="latin inline-block">
                    ${tier.amount}
                </span>
            </p>

            <p className="mt-1 min-h-5 text-small text-muted">
                {closed ? t.unavailable : t.paidInCrypto(price)}
            </p>

            {blurb !== '' && <p className="mt-3 text-small text-muted">{blurb}</p>}

            <div className="mt-auto pt-4">
                <p className="min-h-5 text-caption">
                    {soldOut ? (
                        <span className="text-muted">{t.outOfStock}</span>
                    ) : (
                        <span className="text-firouze">{t.ready(count(tier.available, lang))}</span>
                    )}
                </p>

                {step === 'email' ? (
                    <form
                        className="mt-3"
                        noValidate
                        onSubmit={form.handleSubmit(() => {
                            setFailure('');
                            setStep('confirm');
                        })}
                    >
                        <Field
                            label={t.email}
                            htmlFor={inputId}
                            error={form.errorFor('email') === '' ? '' : t.invalidEmail}
                            hint={form.errorFor('email') === '' ? t.emailHint : undefined}
                        >
                            <TextInput
                                id={inputId}
                                type="email"
                                latin
                                inputMode="email"
                                autoComplete="email"
                                placeholder="you@example.com"
                                disabled={!buyable}
                                invalid={form.errorFor('email') !== ''}
                                value={form.values.email}
                                onChange={(value) => form.set('email', value)}
                            />
                        </Field>

                        <Button
                            type="submit"
                            variant={tier.recommended ? 'primary' : 'outline'}
                            full
                            className="mt-4"
                            disabled={!buyable}
                        >
                            {soldOut ? t.outOfStock : closed ? t.notAvailable : t.proceed}
                        </Button>
                    </form>
                ) : (
                    <div className="mt-3">
                        <div className="rounded-xl border border-line bg-paper p-4">
                            <p className="text-caption text-muted">{t.email}</p>
                            <p
                                dir="ltr"
                                className="latin mt-1 text-start text-lg font-semibold break-all"
                            >
                                {form.values.email}
                            </p>
                            <button
                                type="button"
                                className="mt-2 min-h-tap text-caption font-bold text-firouze hover:underline"
                                onClick={() => setStep('email')}
                            >
                                {t.changeEmail}
                            </button>
                        </div>

                        <dl className="mt-4 grid gap-2 text-small">
                            <div className="flex justify-between gap-2">
                                <dt className="shrink-0 text-muted">{t.total}</dt>
                                <dd className="min-w-0 text-end font-bold">{price}</dd>
                            </div>
                        </dl>

                        {failure !== '' && <p className="mt-4 text-small text-danger">{failure}</p>}

                        <Button
                            variant="primary"
                            full
                            trailing={ArrowRight}
                            className="mt-4"
                            busy={paying}
                            busyText={t.opening}
                            disabled={!buyable}
                            onClick={() => void pay()}
                        >
                            {t.pay(price)}
                        </Button>

                        <p className="mt-3 text-caption text-muted">{t.note}</p>
                    </div>
                )}
            </div>
        </article>
    );
}
