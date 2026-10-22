// The page copy that is NOT the catalogue.
//
// The cards live in the database, because the operator can add and reprice denominations
// from the console, and words that only exist in a bundled TypeScript file cannot be written
// by an operator. `server/src/domain/seed.ts` holds what a first boot starts from; after that
// the console owns them.
//
// What stays here is copy that describes the SERVICE rather than the products: the steps, the
// promises, the questions, and the contact details - in every language, keyed by `Lang`.
// Persian and English are NOT word-for-word translations of each other: every language but
// Persian is the dollar shop, paid in crypto through NOWPayments with its codes emailed, so its
// steps and answers say that. The other languages translate the ENGLISH copy, never the
// Persian one.
//
// MOCK DATA: the values in CONTACT are stand-ins so the page reads as a finished product.
// They are listed in the README under "Replace before launch".
//
// The line that does NOT move: contact details are replaceable content, invented CREDENTIALS
// are not. Nothing here claims a review count, a rating, a testimonial, a certification, a
// badge, or a customer total - a gift-card site that manufactures its own trust signals is
// doing exactly what a scam site does.
import {
    Infinity as InfinityIcon,
    Lock,
    RefreshCw,
    Zap,
    CreditCard,
    ShieldCheck,
    MessageSquareText,
    type LucideIcon
} from 'lucide-react';

import type { Lang } from './lang.ts';

export interface Step {
    glyph: LucideIcon;
    title: string;
    body: string;
}

/** Purchase to working code. These are ordered - the numbering carries real meaning. */
export const STEPS: Record<Lang, Step[]> = {
    fa: [
        {
            glyph: CreditCard,
            title: 'کارت را انتخاب کنید',
            body: 'مبلغ را انتخاب می‌کنید و شماره موبایلتان را روی همان کارت وارد می‌کنید. حسابی نمی‌سازید و رمزی تعیین نمی‌کنید.'
        },
        {
            glyph: ShieldCheck,
            title: 'پرداخت را انجام می‌دهید',
            body: 'به درگاه پرداخت اینترنتی می‌روید و پرداخت را همان‌جا انجام می‌دهید. اطلاعات کارت بانکی شما هرگز به سرور ما نمی‌رسد.'
        },
        {
            glyph: MessageSquareText,
            title: 'کد را همان لحظه می‌گیرید',
            body: 'به محض تأیید پرداخت، کد روی صفحه نمایش داده می‌شود و به همان شماره موبایل پیامک می‌شود.'
        }
    ],
    en: [
        {
            glyph: CreditCard,
            title: 'Pick a card',
            body: 'Choose the amount and type your email address on that card. No account to create and no password to remember.'
        },
        {
            glyph: ShieldCheck,
            title: 'Pay with crypto',
            body: "You pay on NOWPayments's secure checkout page, in the coin you prefer. Your wallet keys never come near our server."
        },
        {
            glyph: MessageSquareText,
            title: 'Get your code',
            body: 'As soon as the payment confirms, the code appears on screen and is emailed to the address you gave.'
        }
    ],
    ar: [
        {
            glyph: CreditCard,
            title: 'اختر بطاقة',
            body: 'اختر المبلغ واكتب بريدك الإلكتروني على تلك البطاقة. لا حاجة لإنشاء حساب ولا لتذكّر كلمة مرور.'
        },
        {
            glyph: ShieldCheck,
            title: 'ادفع بالعملات الرقمية',
            body: 'تدفع على صفحة الدفع الآمنة في NOWPayments، بالعملة التي تفضّلها. مفاتيح محفظتك لا تقترب من خادمنا أبدًا.'
        },
        {
            glyph: MessageSquareText,
            title: 'استلم رمزك',
            body: 'بمجرد تأكيد الدفع، يظهر الرمز على الشاشة ويُرسَل إلى البريد الإلكتروني الذي أدخلته.'
        }
    ],
    es: [
        {
            glyph: CreditCard,
            title: 'Elige una tarjeta',
            body: 'Elige el importe y escribe tu correo electrónico en esa tarjeta. Sin cuentas que crear ni contraseñas que recordar.'
        },
        {
            glyph: ShieldCheck,
            title: 'Paga con criptomonedas',
            body: 'Pagas en la página de pago segura de NOWPayments, con la moneda que prefieras. Las claves de tu billetera nunca se acercan a nuestro servidor.'
        },
        {
            glyph: MessageSquareText,
            title: 'Recibe tu código',
            body: 'En cuanto se confirma el pago, el código aparece en pantalla y se envía al correo que indicaste.'
        }
    ],
    pt: [
        {
            glyph: CreditCard,
            title: 'Escolha um cartão',
            body: 'Escolha o valor e digite seu e-mail nesse cartão. Sem conta para criar e sem senha para lembrar.'
        },
        {
            glyph: ShieldCheck,
            title: 'Pague com cripto',
            body: 'Você paga na página de pagamento segura da NOWPayments, na moeda que preferir. As chaves da sua carteira nunca chegam perto do nosso servidor.'
        },
        {
            glyph: MessageSquareText,
            title: 'Receba seu código',
            body: 'Assim que o pagamento é confirmado, o código aparece na tela e é enviado para o e-mail que você informou.'
        }
    ],
    hi: [
        {
            glyph: CreditCard,
            title: 'कार्ड चुनें',
            body: 'राशि चुनें और उसी कार्ड पर अपना ईमेल पता लिखें। न कोई खाता बनाना है, न कोई पासवर्ड याद रखना है।'
        },
        {
            glyph: ShieldCheck,
            title: 'क्रिप्टो से भुगतान करें',
            body: 'आप NOWPayments के सुरक्षित चेकआउट पेज पर, अपनी पसंद के कॉइन में भुगतान करते हैं। आपके वॉलेट की कुंजियाँ कभी हमारे सर्वर तक नहीं पहुँचतीं।'
        },
        {
            glyph: MessageSquareText,
            title: 'अपना कोड पाएँ',
            body: 'भुगतान की पुष्टि होते ही कोड स्क्रीन पर दिखता है और आपके दिए ईमेल पते पर भेज दिया जाता है।'
        }
    ],
    zh: [
        {
            glyph: CreditCard,
            title: '选择礼品卡',
            body: '选择面额，并在该卡片上填写您的电子邮箱。无需注册账户，也无需记住密码。'
        },
        {
            glyph: ShieldCheck,
            title: '用加密货币支付',
            body: '您在 NOWPayments 的安全支付页面上，用您喜欢的币种付款。您的钱包密钥绝不会接触我们的服务器。'
        },
        {
            glyph: MessageSquareText,
            title: '获取兑换码',
            body: '付款一经确认，兑换码即显示在屏幕上，并发送到您填写的邮箱。'
        }
    ],
    ru: [
        {
            glyph: CreditCard,
            title: 'Выберите карту',
            body: 'Выберите номинал и укажите адрес электронной почты прямо на карте. Не нужно создавать аккаунт и запоминать пароль.'
        },
        {
            glyph: ShieldCheck,
            title: 'Оплатите криптовалютой',
            body: 'Вы платите на защищённой странице оплаты NOWPayments в удобной вам монете. Ключи вашего кошелька никогда не попадают на наш сервер.'
        },
        {
            glyph: MessageSquareText,
            title: 'Получите код',
            body: 'Как только платёж подтверждён, код появляется на экране и отправляется на указанную вами почту.'
        }
    ],
    fr: [
        {
            glyph: CreditCard,
            title: 'Choisissez une carte',
            body: 'Choisissez le montant et saisissez votre adresse e-mail sur cette carte. Aucun compte à créer, aucun mot de passe à retenir.'
        },
        {
            glyph: ShieldCheck,
            title: 'Payez en crypto',
            body: "Vous payez sur la page de paiement sécurisée de NOWPayments, dans la cryptomonnaie de votre choix. Les clés de votre portefeuille n'approchent jamais notre serveur."
        },
        {
            glyph: MessageSquareText,
            title: 'Recevez votre code',
            body: "Dès que le paiement est confirmé, le code s'affiche à l'écran et vous est envoyé à l'adresse indiquée."
        }
    ],
    tr: [
        {
            glyph: CreditCard,
            title: 'Bir kart seçin',
            body: 'Tutarı seçin ve e-posta adresinizi o kartın üzerine yazın. Hesap açmanız ya da şifre hatırlamanız gerekmez.'
        },
        {
            glyph: ShieldCheck,
            title: 'Kriptoyla ödeyin',
            body: "Ödemeyi NOWPayments'ın güvenli ödeme sayfasında, istediğiniz coin ile yaparsınız. Cüzdan anahtarlarınız sunucumuza asla yaklaşmaz."
        },
        {
            glyph: MessageSquareText,
            title: 'Kodunuzu alın',
            body: 'Ödeme onaylanır onaylanmaz kod ekranda görünür ve verdiğiniz e-posta adresine gönderilir.'
        }
    ]
};

export interface Assurance {
    glyph: LucideIcon;

    /** Two or three words - long enough to mean something, short enough not to wrap. */
    label: string;

    /** The one line that makes the label a commitment rather than a slogan. */
    detail: string;
}

/**
 * The hero's four promises. These are the page's primary trust signal, so each one is
 * a commitment the operator has to keep - not a decorative feature bullet.
 */
export const ASSURANCES: Record<Lang, Assurance[]> = {
    fa: [
        { glyph: Zap, label: 'تحویل آنی', detail: 'روی صفحه و با پیامک' },
        { glyph: RefreshCw, label: 'ضمانت بازگشت وجه', detail: 'اگر کد فعال نشود' },
        { glyph: Lock, label: 'بدون ذخیره کارت', detail: 'پرداخت فقط روی درگاه' },
        { glyph: InfinityIcon, label: 'بدون تاریخ انقضا', detail: 'هر وقت خواستید فعال کنید' }
    ],
    en: [
        { glyph: Zap, label: 'Instant delivery', detail: 'On screen and by email' },
        { glyph: RefreshCw, label: 'Money-back promise', detail: 'If the code does not work' },
        { glyph: Lock, label: 'Nothing stored', detail: 'You pay on NOWPayments only' },
        { glyph: InfinityIcon, label: 'No expiry date', detail: 'Redeem whenever you like' }
    ],
    ar: [
        { glyph: Zap, label: 'تسليم فوري', detail: 'على الشاشة وبالبريد الإلكتروني' },
        { glyph: RefreshCw, label: 'ضمان استرداد المال', detail: 'إذا لم يعمل الرمز' },
        { glyph: Lock, label: 'لا نحفظ شيئًا', detail: 'الدفع عبر NOWPayments فقط' },
        { glyph: InfinityIcon, label: 'بلا تاريخ انتهاء', detail: 'استخدمه متى شئت' }
    ],
    es: [
        { glyph: Zap, label: 'Entrega inmediata', detail: 'En pantalla y por correo' },
        { glyph: RefreshCw, label: 'Garantía de reembolso', detail: 'Si el código no funciona' },
        { glyph: Lock, label: 'No guardamos nada', detail: 'Solo pagas en NOWPayments' },
        { glyph: InfinityIcon, label: 'Sin caducidad', detail: 'Canjéalo cuando quieras' }
    ],
    pt: [
        { glyph: Zap, label: 'Entrega imediata', detail: 'Na tela e por e-mail' },
        { glyph: RefreshCw, label: 'Garantia de reembolso', detail: 'Se o código não funcionar' },
        { glyph: Lock, label: 'Nada armazenado', detail: 'Você paga só na NOWPayments' },
        { glyph: InfinityIcon, label: 'Sem validade', detail: 'Resgate quando quiser' }
    ],
    hi: [
        { glyph: Zap, label: 'तुरंत डिलीवरी', detail: 'स्क्रीन पर और ईमेल से' },
        { glyph: RefreshCw, label: 'पैसे वापसी का वादा', detail: 'अगर कोड काम न करे' },
        { glyph: Lock, label: 'कुछ भी सेव नहीं', detail: 'भुगतान केवल NOWPayments पर' },
        { glyph: InfinityIcon, label: 'कोई समाप्ति तिथि नहीं', detail: 'जब चाहें रिडीम करें' }
    ],
    zh: [
        { glyph: Zap, label: '即时交付', detail: '屏幕显示并邮件发送' },
        { glyph: RefreshCw, label: '退款承诺', detail: '兑换码无效可退款' },
        { glyph: Lock, label: '不存储任何信息', detail: '仅在 NOWPayments 付款' },
        { glyph: InfinityIcon, label: '永不过期', detail: '随时兑换' }
    ],
    ru: [
        { glyph: Zap, label: 'Мгновенная выдача', detail: 'На экране и по почте' },
        { glyph: RefreshCw, label: 'Гарантия возврата', detail: 'Если код не работает' },
        { glyph: Lock, label: 'Ничего не храним', detail: 'Оплата только в NOWPayments' },
        { glyph: InfinityIcon, label: 'Без срока действия', detail: 'Активируйте когда угодно' }
    ],
    fr: [
        { glyph: Zap, label: 'Livraison instantanée', detail: "À l'écran et par e-mail" },
        {
            glyph: RefreshCw,
            label: 'Satisfait ou remboursé',
            detail: 'Si le code ne fonctionne pas'
        },
        { glyph: Lock, label: 'Rien de stocké', detail: 'Paiement sur NOWPayments uniquement' },
        {
            glyph: InfinityIcon,
            label: "Sans date d'expiration",
            detail: 'Utilisez-le quand vous voulez'
        }
    ],
    tr: [
        { glyph: Zap, label: 'Anında teslimat', detail: 'Ekranda ve e-postayla' },
        { glyph: RefreshCw, label: 'Para iade garantisi', detail: 'Kod çalışmazsa' },
        { glyph: Lock, label: 'Hiçbir şey saklanmaz', detail: "Ödeme yalnızca NOWPayments'ta" },
        {
            glyph: InfinityIcon,
            label: 'Son kullanma tarihi yok',
            detail: 'İstediğiniz zaman kullanın'
        }
    ]
};

export interface Faq {
    id: string;
    question: string;
    answer: string;
}

/** The questions a cautious buyer actually asks before paying. */
export const FAQS: Record<Lang, Faq[]> = {
    fa: [
        {
            id: 'delivery',
            question: 'کد چه زمانی به دستم می‌رسد؟',
            answer: 'بلافاصله پس از تأیید پرداخت. کد روی همان صفحه نمایش داده می‌شود و به شماره موبایلی که وارد کرده‌اید هم پیامک می‌شود. تا کد را جایی ذخیره نکرده‌اید، صفحه را نبندید.'
        },
        {
            id: 'no-sms',
            question: 'اگر پیامک نرسد چه؟',
            answer: 'کد اصلی روی همین صفحه نمایش داده می‌شود و معتبر است. اگر پیامک نرسید، کد را از صفحه کپی کنید و با شمارهٔ پیگیری با پشتیبانی تماس بگیرید.'
        },
        {
            id: 'reference',
            question: 'شمارهٔ پیگیری به چه درد می‌خورد؟',
            answer: 'شمارهٔ پیگیری همان کد رهگیری تراکنش در بانک است. اگر پولی از حساب شما کم شد و کدی نگرفتید، با اعلام همین شماره سفارش شما را پیدا می‌کنیم؛ یا کد را می‌دهیم یا وجه را برمی‌گردانیم.'
        },
        {
            id: 'not-working',
            question: 'اگر کد کار نکند چه می‌شود؟',
            answer: 'کد را برای پشتیبانی بفرستید. اگر کد مصرف‌نشده باشد و فعال نشود، یا کد جایگزین می‌دهیم یا کل مبلغ را برمی‌گردانیم. انتخاب با شماست.'
        },
        {
            id: 'refund',
            question: 'امکان بازگشت وجه وجود دارد؟',
            answer: 'بله، تا زمانی که کد استفاده نشده باشد. کدی که یک بار مصرف شده قابل بازگشت نیست، چون دیگر ارزشی برای فروشنده ندارد. این محدودیت را پیش از پرداخت می‌گوییم، نه بعد از آن.'
        },
        {
            id: 'payment-data',
            question: 'اطلاعات پرداخت من ذخیره می‌شود؟',
            answer: 'خیر. پرداخت روی درگاه پرداخت اینترنتی انجام می‌شود و شماره کارت بانکی شما وارد سرور ما نمی‌شود. شماره موبایل و سابقه سفارش برای پشتیبانی نگهداری می‌شود.'
        },
        {
            id: 'expiry',
            question: 'کارت تاریخ انقضا دارد؟',
            answer: 'خیر. کد پس از خرید منقضی نمی‌شود و هر زمان که خواستید می‌توانید آن را فعال کنید.'
        },
        {
            id: 'gift',
            question: 'می‌توانم کارت را به کسی هدیه بدهم؟',
            answer: 'بله. کد به دارنده آن تعلق دارد، پس کافی است آن را برای فرد مورد نظر بفرستید. فقط تا وقتی کد را فعال نکرده‌اید آن را جای امنی نگه دارید.'
        }
    ],
    en: [
        {
            id: 'delivery',
            question: 'When do I get my code?',
            answer: 'As soon as your payment confirms on the blockchain - usually a few minutes. The code is shown on this page and emailed to the address you entered. Keep the page open until you have saved it.'
        },
        {
            id: 'pay',
            question: 'How do I pay?',
            answer: "With cryptocurrency, on NOWPayments's checkout page. You choose the coin there; the price is the card's face value in US dollars, and NOWPayments shows the exact amount to send."
        },
        {
            id: 'closed-tab',
            question: 'What if I close the page before the payment confirms?',
            answer: 'Nothing is lost. We keep checking your payment, and the code is emailed to you as soon as it confirms.'
        },
        {
            id: 'no-email',
            question: 'What if the email does not arrive?',
            answer: 'Check your spam folder first. The code on the result page is the real one either way; if you did not save it, contact support with your reference number.'
        },
        {
            id: 'not-working',
            question: 'What if the code does not work?',
            answer: 'Send the code to support. If it is unused and does not activate, we replace it or refund you in full - your choice.'
        },
        {
            id: 'expiry',
            question: 'Does the card expire?',
            answer: 'No. The code does not expire after purchase, and you can redeem it whenever you like.'
        },
        {
            id: 'gift',
            question: 'Can I give the card to someone else?',
            answer: 'Yes. The code belongs to whoever holds it, so just send it to them. Keep it somewhere safe until it is redeemed.'
        }
    ],
    ar: [
        {
            id: 'delivery',
            question: 'متى أستلم الرمز؟',
            answer: 'فور تأكيد دفعتك على البلوك تشين، وعادةً خلال بضع دقائق. يظهر الرمز في هذه الصفحة ويُرسَل إلى البريد الإلكتروني الذي أدخلته. أبقِ الصفحة مفتوحة حتى تحفظه.'
        },
        {
            id: 'pay',
            question: 'كيف أدفع؟',
            answer: 'بالعملات الرقمية، على صفحة الدفع في NOWPayments. تختار العملة هناك؛ والسعر هو القيمة الاسمية للبطاقة بالدولار الأمريكي، ويعرض NOWPayments المبلغ الدقيق الذي عليك إرساله.'
        },
        {
            id: 'closed-tab',
            question: 'ماذا لو أغلقت الصفحة قبل تأكيد الدفع؟',
            answer: 'لن يضيع شيء. نواصل التحقق من دفعتك، ونرسل لك الرمز بالبريد الإلكتروني فور تأكيدها.'
        },
        {
            id: 'no-email',
            question: 'ماذا لو لم تصل الرسالة؟',
            answer: 'تحقّق أولًا من مجلد الرسائل غير المرغوب فيها. الرمز الظاهر في صفحة النتيجة هو الرمز الحقيقي في كل الأحوال؛ وإن لم تحفظه، فتواصل مع الدعم واذكر رقمك المرجعي.'
        },
        {
            id: 'not-working',
            question: 'ماذا لو لم يعمل الرمز؟',
            answer: 'أرسل الرمز إلى الدعم. إذا كان غير مستخدَم ولم يُفعَّل، نستبدله أو نعيد إليك المبلغ كاملًا، والخيار لك.'
        },
        {
            id: 'expiry',
            question: 'هل للبطاقة تاريخ انتهاء؟',
            answer: 'لا. لا تنتهي صلاحية الرمز بعد الشراء، ويمكنك استخدامه متى شئت.'
        },
        {
            id: 'gift',
            question: 'هل يمكنني إهداء البطاقة لشخص آخر؟',
            answer: 'نعم. الرمز ملك لمن يحمله، فما عليك إلا أن ترسله إليه. احتفظ به في مكان آمن حتى يُستخدَم.'
        }
    ],
    es: [
        {
            id: 'delivery',
            question: '¿Cuándo recibo mi código?',
            answer: 'En cuanto tu pago se confirma en la blockchain, normalmente en unos minutos. El código se muestra en esta página y se envía al correo que indicaste. Mantén la página abierta hasta que lo hayas guardado.'
        },
        {
            id: 'pay',
            question: '¿Cómo pago?',
            answer: 'Con criptomonedas, en la página de pago de NOWPayments. Allí eliges la moneda; el precio es el valor nominal de la tarjeta en dólares estadounidenses, y NOWPayments te muestra el importe exacto que debes enviar.'
        },
        {
            id: 'closed-tab',
            question: '¿Y si cierro la página antes de que se confirme el pago?',
            answer: 'No se pierde nada. Seguimos comprobando tu pago y te enviamos el código por correo en cuanto se confirme.'
        },
        {
            id: 'no-email',
            question: '¿Y si no me llega el correo?',
            answer: 'Revisa primero la carpeta de spam. El código de la página de resultado es el válido en cualquier caso; si no lo guardaste, contacta con soporte indicando tu número de referencia.'
        },
        {
            id: 'not-working',
            question: '¿Y si el código no funciona?',
            answer: 'Envía el código a soporte. Si no se ha usado y no se activa, te lo reemplazamos o te devolvemos el importe completo, como prefieras.'
        },
        {
            id: 'expiry',
            question: '¿La tarjeta caduca?',
            answer: 'No. El código no caduca después de la compra y puedes canjearlo cuando quieras.'
        },
        {
            id: 'gift',
            question: '¿Puedo regalar la tarjeta a otra persona?',
            answer: 'Sí. El código pertenece a quien lo tenga, así que basta con enviárselo. Guárdalo en un lugar seguro hasta que se canjee.'
        }
    ],
    pt: [
        {
            id: 'delivery',
            question: 'Quando recebo meu código?',
            answer: 'Assim que seu pagamento for confirmado na blockchain, geralmente em poucos minutos. O código aparece nesta página e é enviado para o e-mail que você informou. Mantenha a página aberta até salvá-lo.'
        },
        {
            id: 'pay',
            question: 'Como eu pago?',
            answer: 'Com criptomoeda, na página de pagamento da NOWPayments. Você escolhe a moeda lá; o preço é o valor de face do cartão em dólares americanos, e a NOWPayments mostra o valor exato a enviar.'
        },
        {
            id: 'closed-tab',
            question: 'E se eu fechar a página antes de o pagamento ser confirmado?',
            answer: 'Nada se perde. Continuamos verificando seu pagamento, e o código é enviado para o seu e-mail assim que ele for confirmado.'
        },
        {
            id: 'no-email',
            question: 'E se o e-mail não chegar?',
            answer: 'Confira primeiro sua pasta de spam. O código na página de resultado é o verdadeiro de qualquer forma; se você não o salvou, fale com o suporte informando seu número de referência.'
        },
        {
            id: 'not-working',
            question: 'E se o código não funcionar?',
            answer: 'Envie o código para o suporte. Se ele não tiver sido usado e não ativar, nós o substituímos ou devolvemos o valor integral - você escolhe.'
        },
        {
            id: 'expiry',
            question: 'O cartão tem validade?',
            answer: 'Não. O código não expira depois da compra, e você pode resgatá-lo quando quiser.'
        },
        {
            id: 'gift',
            question: 'Posso dar o cartão de presente para outra pessoa?',
            answer: 'Sim. O código pertence a quem o tiver, então é só enviá-lo para a pessoa. Guarde-o em um lugar seguro até ser resgatado.'
        }
    ],
    hi: [
        {
            id: 'delivery',
            question: 'मुझे कोड कब मिलेगा?',
            answer: 'जैसे ही ब्लॉकचेन पर आपके भुगतान की पुष्टि होती है - आमतौर पर कुछ ही मिनटों में। कोड इसी पेज पर दिखता है और आपके दर्ज किए ईमेल पते पर भेजा जाता है। कोड सेव करने तक पेज खुला रखें।'
        },
        {
            id: 'pay',
            question: 'मैं भुगतान कैसे करूँ?',
            answer: 'क्रिप्टोकरेंसी से, NOWPayments के चेकआउट पेज पर। कॉइन आप वहीं चुनते हैं; कीमत अमेरिकी डॉलर में कार्ड का अंकित मूल्य है, और NOWPayments भेजी जाने वाली सटीक राशि दिखाता है।'
        },
        {
            id: 'closed-tab',
            question: 'अगर भुगतान की पुष्टि से पहले मैं पेज बंद कर दूँ तो?',
            answer: 'कुछ नहीं खोता। हम आपके भुगतान की जाँच करते रहते हैं, और पुष्टि होते ही कोड आपको ईमेल कर दिया जाता है।'
        },
        {
            id: 'no-email',
            question: 'अगर ईमेल न आए तो?',
            answer: 'पहले अपना स्पैम फ़ोल्डर देखें। नतीजे वाले पेज पर दिखा कोड ही असली कोड है; अगर आपने उसे सेव नहीं किया, तो अपने रेफ़रेंस नंबर के साथ सपोर्ट से संपर्क करें।'
        },
        {
            id: 'not-working',
            question: 'अगर कोड काम न करे तो?',
            answer: 'कोड सपोर्ट को भेजें। अगर वह इस्तेमाल नहीं हुआ है और सक्रिय नहीं होता, तो हम उसे बदल देंगे या पूरा पैसा लौटा देंगे - चुनाव आपका।'
        },
        {
            id: 'expiry',
            question: 'क्या कार्ड की कोई समाप्ति तिथि है?',
            answer: 'नहीं। खरीद के बाद कोड की समय-सीमा खत्म नहीं होती, और आप उसे जब चाहें रिडीम कर सकते हैं।'
        },
        {
            id: 'gift',
            question: 'क्या कार्ड किसी और को तोहफ़े में दिया जा सकता है?',
            answer: 'हाँ। कोड उसी का है जिसके पास वह है, इसलिए बस उसे भेज दें। रिडीम होने तक उसे किसी सुरक्षित जगह रखें।'
        }
    ],
    zh: [
        {
            id: 'delivery',
            question: '我什么时候能收到兑换码？',
            answer: '您的付款在区块链上确认后即可收到，通常只需几分钟。兑换码会显示在本页面上，并发送到您填写的邮箱。保存好之前请不要关闭页面。'
        },
        {
            id: 'pay',
            question: '如何付款？',
            answer: '在 NOWPayments 的支付页面上使用加密货币付款。您在那里选择币种；价格为礼品卡的美元面值，NOWPayments 会显示需要发送的准确金额。'
        },
        {
            id: 'closed-tab',
            question: '如果在付款确认前关闭了页面怎么办？',
            answer: '不会有任何损失。我们会持续核查您的付款，一经确认就会通过邮件把兑换码发给您。'
        },
        {
            id: 'no-email',
            question: '如果没有收到邮件怎么办？',
            answer: '请先检查垃圾邮件文件夹。无论如何，结果页面上显示的兑换码都是真实有效的；如果您没有保存，请凭参考编号联系客服。'
        },
        {
            id: 'not-working',
            question: '如果兑换码无法使用怎么办？',
            answer: '请把兑换码发给客服。如果它未被使用且无法激活，我们会为您更换或全额退款，由您选择。'
        },
        {
            id: 'expiry',
            question: '礼品卡会过期吗？',
            answer: '不会。兑换码购买后不会过期，您可以随时兑换。'
        },
        {
            id: 'gift',
            question: '可以把礼品卡送给别人吗？',
            answer: '可以。兑换码归持有人所有，直接发给对方即可。兑换之前请妥善保管。'
        }
    ],
    ru: [
        {
            id: 'delivery',
            question: 'Когда я получу код?',
            answer: 'Как только платёж подтвердится в блокчейне - обычно в течение нескольких минут. Код показывается на этой странице и отправляется на указанную почту. Не закрывайте страницу, пока не сохраните его.'
        },
        {
            id: 'pay',
            question: 'Как оплатить?',
            answer: 'Криптовалютой, на странице оплаты NOWPayments. Монету вы выбираете там; цена - номинал карты в долларах США, а NOWPayments показывает точную сумму к отправке.'
        },
        {
            id: 'closed-tab',
            question: 'Что, если я закрою страницу до подтверждения платежа?',
            answer: 'Ничего не потеряется. Мы продолжаем проверять платёж и отправим код на почту, как только он подтвердится.'
        },
        {
            id: 'no-email',
            question: 'Что, если письмо не пришло?',
            answer: 'Сначала проверьте папку «Спам». Код на странице результата в любом случае настоящий; если вы его не сохранили, напишите в поддержку и укажите номер операции.'
        },
        {
            id: 'not-working',
            question: 'Что, если код не работает?',
            answer: 'Отправьте код в поддержку. Если он не использован и не активируется, мы заменим его или вернём всю сумму - на ваш выбор.'
        },
        {
            id: 'expiry',
            question: 'Есть ли у карты срок действия?',
            answer: 'Нет. Срок действия кода не истекает после покупки, и вы можете активировать его когда угодно.'
        },
        {
            id: 'gift',
            question: 'Можно ли подарить карту другому человеку?',
            answer: 'Да. Код принадлежит тому, у кого он есть, так что просто отправьте его. Храните его в надёжном месте, пока он не активирован.'
        }
    ],
    fr: [
        {
            id: 'delivery',
            question: 'Quand vais-je recevoir mon code ?',
            answer: "Dès que votre paiement est confirmé sur la blockchain, généralement en quelques minutes. Le code s'affiche sur cette page et vous est envoyé à l'adresse e-mail saisie. Gardez la page ouverte jusqu'à ce que vous l'ayez enregistré."
        },
        {
            id: 'pay',
            question: 'Comment payer ?',
            answer: 'En cryptomonnaie, sur la page de paiement de NOWPayments. Vous y choisissez la monnaie ; le prix correspond à la valeur faciale de la carte en dollars américains, et NOWPayments affiche le montant exact à envoyer.'
        },
        {
            id: 'closed-tab',
            question: 'Et si je ferme la page avant la confirmation du paiement ?',
            answer: "Rien n'est perdu. Nous continuons de vérifier votre paiement, et le code vous est envoyé par e-mail dès sa confirmation."
        },
        {
            id: 'no-email',
            question: "Et si l'e-mail n'arrive pas ?",
            answer: "Vérifiez d'abord vos courriers indésirables. Le code affiché sur la page de résultat est de toute façon le vrai ; si vous ne l'avez pas enregistré, contactez le support avec votre numéro de référence."
        },
        {
            id: 'not-working',
            question: 'Et si le code ne fonctionne pas ?',
            answer: "Envoyez le code au support. S'il n'a pas été utilisé et ne s'active pas, nous le remplaçons ou vous remboursons intégralement, au choix."
        },
        {
            id: 'expiry',
            question: 'La carte expire-t-elle ?',
            answer: "Non. Le code n'expire pas après l'achat, et vous pouvez l'utiliser quand vous voulez."
        },
        {
            id: 'gift',
            question: "Puis-je offrir la carte à quelqu'un ?",
            answer: "Oui. Le code appartient à la personne qui le détient : il suffit de le lui envoyer. Conservez-le en lieu sûr jusqu'à son utilisation."
        }
    ],
    tr: [
        {
            id: 'delivery',
            question: 'Kodumu ne zaman alırım?',
            answer: 'Ödemeniz blokzincirde onaylanır onaylanmaz; genellikle birkaç dakika içinde. Kod bu sayfada gösterilir ve girdiğiniz e-posta adresine gönderilir. Kodu kaydedene kadar sayfayı açık tutun.'
        },
        {
            id: 'pay',
            question: 'Nasıl ödeme yaparım?',
            answer: "Kripto parayla, NOWPayments'ın ödeme sayfasında. Coin'i orada seçersiniz; fiyat, kartın ABD doları cinsinden nominal değeridir ve NOWPayments göndermeniz gereken tam tutarı gösterir."
        },
        {
            id: 'closed-tab',
            question: 'Ödeme onaylanmadan sayfayı kapatırsam ne olur?',
            answer: 'Hiçbir şey kaybolmaz. Ödemenizi kontrol etmeye devam ederiz ve onaylanır onaylanmaz kod e-postanıza gönderilir.'
        },
        {
            id: 'no-email',
            question: 'E-posta gelmezse ne olur?',
            answer: 'Önce spam klasörünüzü kontrol edin. Sonuç sayfasındaki kod her durumda gerçek koddur; kaydetmediyseniz referans numaranızla destek ekibine ulaşın.'
        },
        {
            id: 'not-working',
            question: 'Kod çalışmazsa ne olur?',
            answer: 'Kodu destek ekibine gönderin. Kullanılmamışsa ve etkinleşmiyorsa kodu değiştiririz ya da ücretin tamamını iade ederiz - seçim sizin.'
        },
        {
            id: 'expiry',
            question: 'Kartın son kullanma tarihi var mı?',
            answer: 'Hayır. Kodun süresi satın alındıktan sonra dolmaz; istediğiniz zaman kullanabilirsiniz.'
        },
        {
            id: 'gift',
            question: 'Kartı başka birine hediye edebilir miyim?',
            answer: 'Evet. Kod, kimdeyse ona aittir; o kişiye göndermeniz yeterli. Kullanılana kadar güvenli bir yerde saklayın.'
        }
    ]
};

/** Support and identity. MOCK VALUES - see the README's "Replace before launch". */
export const CONTACT = {
    telegram: 'https://t.me/awesomext',
    phone: '+98 912 2636 180',
    hours: {
        fa: 'هر روز، ۹ صبح تا ۹ شب به وقت تهران',
        en: 'Every day, 9 am to 9 pm Tehran time',
        ar: 'يوميًا، من 9 صباحًا حتى 9 مساءً بتوقيت طهران',
        es: 'Todos los días, de 9:00 a 21:00, hora de Teherán',
        pt: 'Todos os dias, das 9h às 21h, horário de Teerã',
        hi: 'हर दिन, सुबह 9 बजे से रात 9 बजे तक (तेहरान समय)',
        zh: '每天 9:00 至 21:00（德黑兰时间）',
        ru: 'Ежедневно с 9:00 до 21:00 по тегеранскому времени',
        fr: 'Tous les jours, de 9 h à 21 h, heure de Téhéran',
        tr: 'Her gün 09.00-21.00 (Tahran saati)'
    } satisfies Record<Lang, string>,
    operator: 'شرکت داده‌پردازی اشبرینگر'
};

/**
 * The eNamad trust seal.
 *
 * THE HEADER OF THIS FILE FORBIDS INVENTED BADGES, AND THIS IS NOT ONE. Everything in a
 * self-made trust signal is written by the site making the claim; none of this is. The id and
 * the code are issued by enamad.ir to a registered business, the image is served by enamad's
 * own server, and the seal links back to enamad's page where the licence can be read by
 * anybody who doubts it. A reader can check this claim, which is the whole difference.
 *
 * BOTH VALUES ARE LICENSED TO ONE DOMAIN. They belong to the address in `publicBaseUrl` and
 * mean nothing served from another host - see the note on the link in App.tsx.
 */
export const ENAMAD = {
    id: '716988',
    code: '0ucbntRpzbfCHytc3RznQyd6qwqANIja'
};
