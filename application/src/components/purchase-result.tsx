// What happened to a payment, read back after the gateway sends the buyer here.
//
// This is all that remains of the old purchase panel. The mobile step and the confirm step
// moved into the cards; what could not move is this, because the buyer arrives at it from
// the GATEWAY rather than from a click, carrying a token in the URL. It is the one part of
// the purchase that is about a journey already finished.
//
// THE DOLLAR-SHOP BUYER ARRIVES WITHOUT A TOKEN. NOWPayments sends them back to their own
// language's page, `/<lang>?pay=return` (the server builds it from a fixed list), so the token
// comes out of this tab's storage instead (lib/pending-receipt.ts) and is put on the address,
// after which the panel behaves exactly as it does for a Persian buyer. And such a receipt can
// be `pending` - a crypto payment confirming - which is polled until it is not: the server
// asks NOWPayments on each poll, so this is also how a lost callback is caught.
//
// It renders NOTHING when there is no token and no stray callback, so an ordinary visit does
// not carry an empty panel around. The router's search params are the source of truth -
// `location.search` would be read once and never again.
import { Check, Clock, Copy, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { client } from '../lib/api.ts';
import type { Receipt } from '../../../server/src/contract/index.ts';
import { CONTACT } from '../lib/content.ts';
import { toman, usd } from '../lib/format.ts';
import { shopOf, useCopy, useLang, type Lang } from '../lib/lang.ts';
import { forgetReceipt, recallReceipt } from '../lib/pending-receipt.ts';
import { useToasts } from '../ui/toast.tsx';
import Button from '../ui/button.tsx';
import CodeCapsule from './code-capsule.tsx';

/** How often a confirming English payment is asked about again. Matches the server's limit. */
const POLL_MS = 15_000;

interface ResultCopy {
    copyFailed: string;
    strayTitle: string;
    strayBody: string;
    backToShop: string;
    failedReadTitle: string;
    failedReadBody: string;
    checking: string;
    lostTitle: string;
    lostBody: string;
    pendingTitle: string;
    pendingBody: string;
    paidTitle: string;
    paidBody: string;
    codeLabel: string;
    copied: string;
    copy: string;
    another: string;
    reference: string;
    paid: string;
    price: (receipt: Receipt) => string;
    contact: string;
    delivered: string;
    notDelivered: string;
    owedTitle: string;
    owedBody: string;
    cancelledTitle: string;
    cancelledBody: string;
    tryAgain: string;
    failedTitle: string;
    failedBody: string;
}

const COPY: Record<Lang, ResultCopy> = {
    fa: {
        copyFailed: 'کپی نشد. کد را دستی انتخاب کنید؛ کد شما همان است که می‌بینید.',
        strayTitle: 'این پرداخت پیدا نشد',
        strayBody:
            'سفارشی با این مشخصات نداریم. اگر مبلغی از حساب شما کم شده، با پشتیبانی تماس بگیرید تا بررسی کنیم.',
        backToShop: 'بازگشت به خرید',
        failedReadTitle: 'نتیجهٔ پرداخت در دسترس نیست',
        failedReadBody:
            'نتوانستیم وضعیت این سفارش را بخوانیم. صفحه را دوباره باز کنید؛ اگر باز هم نشد با پشتیبانی تماس بگیرید.',
        checking: 'در حال بررسی نتیجهٔ پرداخت...',
        // The next four are the English shop's states; a Persian order never reaches them, and
        // they are written out only so that both halves have the same shape.
        lostTitle: 'در حال بررسی پرداخت شما',
        lostBody: 'اگر پرداخت کرده‌اید، کد پس از تأیید پرداخت برایتان فرستاده می‌شود.',
        pendingTitle: 'در انتظار تأیید پرداخت',
        pendingBody: 'تأیید پرداخت چند دقیقه طول می‌کشد. این صفحه خودش به‌روز می‌شود.',
        paidTitle: 'پرداخت تأیید شد',
        paidBody: 'این کد شماست. تا آن را جایی ذخیره نکرده‌اید صفحه را نبندید.',
        codeLabel: 'کد گیفت کارت شما',
        copied: 'کپی شد',
        copy: 'کپی کردن کد',
        another: 'خرید کارت دیگر',
        reference: 'شمارهٔ پیگیری',
        paid: 'پرداخت‌شده:',
        price: (receipt: Receipt) => `${toman(receipt.toman)} تومان`,
        contact: 'شماره موبایل:',
        delivered: 'کد خرید به این شماره پیامک شد.',
        notDelivered: 'پیامک ارسال نشد، اما کد شما همین است و معتبر است. آن را همین‌جا کپی کنید.',
        owedTitle: 'پرداخت شما تأیید شد، اما کد آماده نیست',
        owedBody:
            'مبلغ از حساب شما کم شده و سفارشتان ثبت است، ولی موجودی کد این کارت همان لحظه تمام شد. با شمارهٔ پیگیری زیر با پشتیبانی تماس بگیرید: یا کد را می‌فرستیم یا کل مبلغ را برمی‌گردانیم.',
        cancelledTitle: 'پرداخت لغو شد',
        cancelledBody: 'مبلغی از حساب شما کم نشده است. هر وقت خواستید دوباره امتحان کنید.',
        tryAgain: 'تلاش دوباره',
        failedTitle: 'پرداخت تأیید نشد',
        failedBody:
            'بانک این تراکنش را تأیید نکرد. اگر مبلغی از حساب شما کم شده باشد، طبق روال بانکی تا ۷۲ ساعت برمی‌گردد. برای پیگیری با پشتیبانی تماس بگیرید.'
    },
    en: {
        copyFailed: 'Could not copy. Select the code by hand - the code you see is yours.',
        strayTitle: 'This payment was not found',
        strayBody:
            'We have no order matching it. If you were charged, contact support and we will look into it.',
        backToShop: 'Back to the shop',
        failedReadTitle: 'The payment result is unavailable',
        failedReadBody:
            'We could not read the status of this order. Reload the page; if that does not help, contact support.',
        checking: 'Checking your payment...',
        lostTitle: 'Thanks - we are checking your payment',
        lostBody:
            'If you paid, your code will be emailed to you as soon as the payment confirms. Check your spam folder too.',
        pendingTitle: 'Waiting for your payment to confirm',
        pendingBody:
            'Crypto payments take a few minutes to confirm on the blockchain. This page updates by itself, and the code is emailed to you too - you can close it if you need to.',
        paidTitle: 'Payment confirmed',
        paidBody: 'This is your code. Do not close the page until you have saved it.',
        codeLabel: 'Your gift card code',
        copied: 'Copied',
        copy: 'Copy code',
        another: 'Buy another card',
        reference: 'Reference',
        paid: 'Paid:',
        price: (receipt: Receipt) => usd(receipt.amount, 'en'),
        contact: 'Email:',
        delivered: 'The code was emailed to this address.',
        notDelivered:
            'The email could not be sent, but this code is yours and it is valid. Copy it from here.',
        owedTitle: 'Your payment is confirmed, but the code is not ready',
        owedBody:
            'Your payment went through and your order is recorded, but this card sold out at that moment. Contact support with the reference below: we will send a code or refund you in full.',
        cancelledTitle: 'Payment cancelled',
        cancelledBody: 'You were not charged. Try again whenever you like.',
        tryAgain: 'Try again',
        failedTitle: 'Payment not confirmed',
        failedBody:
            'The invoice expired or was not paid in full. If you sent a payment, contact support and we will sort it out.'
    },
    ar: {
        copyFailed: 'تعذّر النسخ. حدّد الرمز يدويًا - الرمز الذي تراه هو رمزك.',
        strayTitle: 'لم يُعثر على هذه الدفعة',
        strayBody: 'لا يوجد لدينا طلب مطابق لها. إذا خُصم منك مبلغ، فتواصل مع الدعم وسنتحقق من الأمر.',
        backToShop: 'العودة إلى المتجر',
        failedReadTitle: 'نتيجة الدفع غير متاحة',
        failedReadBody:
            'تعذّرت قراءة حالة هذا الطلب. أعد تحميل الصفحة؛ وإن لم ينجح ذلك فتواصل مع الدعم.',
        checking: 'جارٍ التحقق من دفعتك...',
        lostTitle: 'شكرًا لك - نتحقق من دفعتك الآن',
        lostBody:
            'إذا كنت قد دفعت، فسيصلك الرمز عبر البريد الإلكتروني فور تأكيد الدفع. تحقّق من مجلد الرسائل غير المرغوب فيها أيضًا.',
        pendingTitle: 'بانتظار تأكيد دفعتك',
        pendingBody:
            'يستغرق تأكيد المدفوعات الرقمية على البلوك تشين بضع دقائق. تتحدّث هذه الصفحة تلقائيًا، وسيُرسل الرمز إلى بريدك الإلكتروني أيضًا - يمكنك إغلاقها إن احتجت.',
        paidTitle: 'تم تأكيد الدفع',
        paidBody: 'هذا هو رمزك. لا تغلق الصفحة قبل أن تحفظه.',
        codeLabel: 'رمز بطاقة الهدايا الخاص بك',
        copied: 'تم النسخ',
        copy: 'نسخ الرمز',
        another: 'شراء بطاقة أخرى',
        reference: 'الرقم المرجعي',
        paid: 'المبلغ المدفوع:',
        price: (receipt: Receipt) => usd(receipt.amount, 'ar'),
        contact: 'البريد الإلكتروني:',
        delivered: 'أُرسل الرمز إلى هذا البريد الإلكتروني.',
        notDelivered: 'تعذّر إرسال البريد الإلكتروني، لكن هذا الرمز لك وهو صالح. انسخه من هنا.',
        owedTitle: 'تم تأكيد دفعتك، لكن الرمز غير جاهز',
        owedBody:
            'تمت عملية الدفع وسُجّل طلبك، لكن هذه البطاقة نفدت في تلك اللحظة. تواصل مع الدعم مع ذكر الرقم المرجعي أدناه: سنرسل لك رمزًا أو نعيد إليك المبلغ كاملًا.',
        cancelledTitle: 'أُلغي الدفع',
        cancelledBody: 'لم يُخصم منك أي مبلغ. حاول مجددًا متى شئت.',
        tryAgain: 'حاول مجددًا',
        failedTitle: 'لم يتم تأكيد الدفع',
        failedBody:
            'انتهت صلاحية الفاتورة أو لم تُدفع بالكامل. إذا أرسلت دفعة، فتواصل مع الدعم وسنحل الأمر.'
    },
    es: {
        copyFailed: 'No se pudo copiar. Selecciona el código a mano: el código que ves es el tuyo.',
        strayTitle: 'No encontramos este pago',
        strayBody:
            'No tenemos ningún pedido que coincida. Si se te cobró, contacta con soporte y lo revisaremos.',
        backToShop: 'Volver a la tienda',
        failedReadTitle: 'El resultado del pago no está disponible',
        failedReadBody:
            'No pudimos leer el estado de este pedido. Recarga la página; si no se soluciona, contacta con soporte.',
        checking: 'Comprobando tu pago...',
        lostTitle: 'Gracias, estamos comprobando tu pago',
        lostBody:
            'Si ya pagaste, te enviaremos el código por correo en cuanto se confirme el pago. Revisa también la carpeta de spam.',
        pendingTitle: 'Esperando la confirmación de tu pago',
        pendingBody:
            'Los pagos con criptomonedas tardan unos minutos en confirmarse en la blockchain. Esta página se actualiza sola y el código también te llegará por correo; puedes cerrarla si lo necesitas.',
        paidTitle: 'Pago confirmado',
        paidBody: 'Este es tu código. No cierres la página hasta haberlo guardado.',
        codeLabel: 'Tu código de tarjeta de regalo',
        copied: 'Copiado',
        copy: 'Copiar código',
        another: 'Comprar otra tarjeta',
        reference: 'Referencia',
        paid: 'Pagado:',
        price: (receipt: Receipt) => usd(receipt.amount, 'es'),
        contact: 'Correo:',
        delivered: 'Enviamos el código a esta dirección.',
        notDelivered:
            'No se pudo enviar el correo, pero este código es tuyo y es válido. Cópialo desde aquí.',
        owedTitle: 'Tu pago está confirmado, pero el código no está listo',
        owedBody:
            'Tu pago se completó y tu pedido está registrado, pero esta tarjeta se agotó en ese momento. Contacta con soporte indicando la referencia de abajo: te enviaremos un código o te devolveremos el importe completo.',
        cancelledTitle: 'Pago cancelado',
        cancelledBody: 'No se te ha cobrado nada. Vuelve a intentarlo cuando quieras.',
        tryAgain: 'Intentar de nuevo',
        failedTitle: 'Pago no confirmado',
        failedBody:
            'La factura caducó o no se pagó por completo. Si enviaste un pago, contacta con soporte y lo resolveremos.'
    },
    pt: {
        copyFailed:
            'Não foi possível copiar. Selecione o código manualmente - o código que você vê é o seu.',
        strayTitle: 'Este pagamento não foi encontrado',
        strayBody:
            'Não temos nenhum pedido correspondente. Se você foi cobrado, fale com o suporte e vamos verificar.',
        backToShop: 'Voltar à loja',
        failedReadTitle: 'O resultado do pagamento não está disponível',
        failedReadBody:
            'Não conseguimos ler o status deste pedido. Recarregue a página; se não resolver, fale com o suporte.',
        checking: 'Verificando seu pagamento...',
        lostTitle: 'Obrigado - estamos verificando seu pagamento',
        lostBody:
            'Se você pagou, o código será enviado por e-mail assim que o pagamento for confirmado. Confira também a pasta de spam.',
        pendingTitle: 'Aguardando a confirmação do pagamento',
        pendingBody:
            'Pagamentos em cripto levam alguns minutos para serem confirmados na blockchain. Esta página se atualiza sozinha e o código também será enviado por e-mail - você pode fechá-la se precisar.',
        paidTitle: 'Pagamento confirmado',
        paidBody: 'Este é o seu código. Não feche a página antes de salvá-lo.',
        codeLabel: 'Seu código do cartão-presente',
        copied: 'Copiado',
        copy: 'Copiar código',
        another: 'Comprar outro cartão',
        reference: 'Referência',
        paid: 'Pago:',
        price: (receipt: Receipt) => usd(receipt.amount, 'pt'),
        contact: 'E-mail:',
        delivered: 'O código foi enviado para este e-mail.',
        notDelivered:
            'Não foi possível enviar o e-mail, mas este código é seu e é válido. Copie-o daqui.',
        owedTitle: 'Seu pagamento foi confirmado, mas o código não está pronto',
        owedBody:
            'Seu pagamento foi concluído e seu pedido está registrado, mas este cartão esgotou naquele momento. Fale com o suporte informando a referência abaixo: enviaremos um código ou devolveremos o valor integral.',
        cancelledTitle: 'Pagamento cancelado',
        cancelledBody: 'Nada foi cobrado. Tente novamente quando quiser.',
        tryAgain: 'Tentar novamente',
        failedTitle: 'Pagamento não confirmado',
        failedBody:
            'A fatura expirou ou não foi paga integralmente. Se você enviou um pagamento, fale com o suporte e vamos resolver.'
    },
    hi: {
        copyFailed: 'कॉपी नहीं हो सका। कोड को हाथ से चुनें - जो कोड आप देख रहे हैं, वही आपका है।',
        strayTitle: 'यह भुगतान नहीं मिला',
        strayBody:
            'इससे मेल खाता कोई ऑर्डर हमारे पास नहीं है। अगर आपसे पैसे कटे हैं, तो सहायता टीम से संपर्क करें, हम जाँच करेंगे।',
        backToShop: 'दुकान पर वापस जाएँ',
        failedReadTitle: 'भुगतान का नतीजा उपलब्ध नहीं है',
        failedReadBody:
            'हम इस ऑर्डर की स्थिति नहीं पढ़ सके। पेज को फिर से लोड करें; अगर फिर भी न हो, तो सहायता टीम से संपर्क करें।',
        checking: 'आपके भुगतान की जाँच हो रही है...',
        lostTitle: 'धन्यवाद - हम आपके भुगतान की जाँच कर रहे हैं',
        lostBody:
            'अगर आपने भुगतान कर दिया है, तो भुगतान की पुष्टि होते ही कोड आपको ईमेल कर दिया जाएगा। स्पैम फ़ोल्डर भी देख लें।',
        pendingTitle: 'आपके भुगतान की पुष्टि का इंतज़ार है',
        pendingBody:
            'क्रिप्टो भुगतान की ब्लॉकचेन पर पुष्टि होने में कुछ मिनट लगते हैं। यह पेज अपने-आप अपडेट होता है और कोड आपको ईमेल भी किया जाएगा - ज़रूरत हो तो आप इसे बंद कर सकते हैं।',
        paidTitle: 'भुगतान की पुष्टि हो गई',
        paidBody: 'यह आपका कोड है। इसे सहेजने से पहले पेज बंद न करें।',
        codeLabel: 'आपका गिफ़्ट कार्ड कोड',
        copied: 'कॉपी हो गया',
        copy: 'कोड कॉपी करें',
        another: 'एक और कार्ड खरीदें',
        reference: 'संदर्भ संख्या',
        paid: 'भुगतान:',
        price: (receipt: Receipt) => usd(receipt.amount, 'hi'),
        contact: 'ईमेल:',
        delivered: 'कोड इस पते पर ईमेल कर दिया गया है।',
        notDelivered: 'ईमेल नहीं भेजा जा सका, लेकिन यह कोड आपका है और मान्य है। इसे यहीं से कॉपी कर लें।',
        owedTitle: 'आपके भुगतान की पुष्टि हो गई, लेकिन कोड तैयार नहीं है',
        owedBody:
            'आपका भुगतान हो गया है और ऑर्डर दर्ज है, लेकिन उसी समय यह कार्ड खत्म हो गया। नीचे दी गई संदर्भ संख्या के साथ सहायता टीम से संपर्क करें: हम आपको कोड भेजेंगे या पूरी राशि लौटा देंगे।',
        cancelledTitle: 'भुगतान रद्द हुआ',
        cancelledBody: 'आपसे कोई पैसा नहीं कटा। जब चाहें फिर से कोशिश करें।',
        tryAgain: 'फिर से कोशिश करें',
        failedTitle: 'भुगतान की पुष्टि नहीं हुई',
        failedBody:
            'इनवॉइस की समय-सीमा खत्म हो गई या पूरा भुगतान नहीं हुआ। अगर आपने भुगतान भेजा है, तो सहायता टीम से संपर्क करें, हम इसे सुलझा देंगे।'
    },
    zh: {
        copyFailed: '复制失败。请手动选中兑换码——您看到的就是您的兑换码。',
        strayTitle: '未找到此笔付款',
        strayBody: '我们没有与之匹配的订单。如果您已被扣款，请联系客服，我们会进行核查。',
        backToShop: '返回商店',
        failedReadTitle: '暂时无法获取付款结果',
        failedReadBody: '我们无法读取此订单的状态。请刷新页面；如仍无法解决，请联系客服。',
        checking: '正在查询您的付款...',
        lostTitle: '感谢您——我们正在核实您的付款',
        lostBody: '如果您已付款，付款确认后兑换码会立即发送到您的邮箱。也请查看垃圾邮件文件夹。',
        pendingTitle: '正在等待付款确认',
        pendingBody:
            '加密货币付款需要几分钟在区块链上确认。本页面会自动更新，兑换码也会发送到您的邮箱——如有需要，您可以关闭此页面。',
        paidTitle: '付款已确认',
        paidBody: '这是您的兑换码。保存之前请不要关闭页面。',
        codeLabel: '您的礼品卡兑换码',
        copied: '已复制',
        copy: '复制兑换码',
        another: '再买一张',
        reference: '参考编号',
        paid: '已付：',
        price: (receipt: Receipt) => usd(receipt.amount, 'zh'),
        contact: '邮箱：',
        delivered: '兑换码已发送到此邮箱。',
        notDelivered: '邮件未能发送，但此兑换码属于您且有效。请在此处复制。',
        owedTitle: '您的付款已确认，但兑换码尚未就绪',
        owedBody:
            '您的付款已完成，订单已记录，但此卡在那一刻恰好售罄。请凭下方参考编号联系客服：我们会为您发送兑换码或全额退款。',
        cancelledTitle: '付款已取消',
        cancelledBody: '您未被扣款。随时可以再试一次。',
        tryAgain: '重试',
        failedTitle: '付款未确认',
        failedBody: '账单已过期或未足额支付。如果您已发送付款，请联系客服，我们会为您处理。'
    },
    ru: {
        copyFailed: 'Не удалось скопировать. Выделите код вручную - код, который вы видите, ваш.',
        strayTitle: 'Платёж не найден',
        strayBody:
            'У нас нет соответствующего заказа. Если деньги списались, напишите в поддержку, и мы разберёмся.',
        backToShop: 'Вернуться в магазин',
        failedReadTitle: 'Результат оплаты недоступен',
        failedReadBody:
            'Не удалось получить статус заказа. Обновите страницу; если не поможет, обратитесь в поддержку.',
        checking: 'Проверяем ваш платёж...',
        lostTitle: 'Спасибо - мы проверяем ваш платёж',
        lostBody:
            'Если вы оплатили, код придёт на почту сразу после подтверждения платежа. Проверьте также папку «Спам».',
        pendingTitle: 'Ожидаем подтверждения платежа',
        pendingBody:
            'Подтверждение криптоплатежа в блокчейне занимает несколько минут. Страница обновляется сама, а код также придёт на почту - при необходимости её можно закрыть.',
        paidTitle: 'Оплата подтверждена',
        paidBody: 'Это ваш код. Не закрывайте страницу, пока не сохраните его.',
        codeLabel: 'Код вашей подарочной карты',
        copied: 'Скопировано',
        copy: 'Скопировать код',
        another: 'Купить ещё одну карту',
        reference: 'Номер заказа',
        paid: 'Оплачено:',
        price: (receipt: Receipt) => usd(receipt.amount, 'ru'),
        contact: 'Почта:',
        delivered: 'Код отправлен на этот адрес.',
        notDelivered:
            'Письмо отправить не удалось, но этот код ваш и он действителен. Скопируйте его отсюда.',
        owedTitle: 'Оплата подтверждена, но код не готов',
        owedBody:
            'Платёж прошёл, и заказ зарегистрирован, но в этот момент карта закончилась. Обратитесь в поддержку, указав номер заказа ниже: мы отправим код или вернём деньги полностью.',
        cancelledTitle: 'Оплата отменена',
        cancelledBody: 'Деньги не списаны. Попробуйте снова, когда захотите.',
        tryAgain: 'Попробовать снова',
        failedTitle: 'Оплата не подтверждена',
        failedBody:
            'Срок счёта истёк или он оплачен не полностью. Если вы отправили платёж, обратитесь в поддержку, и мы всё уладим.'
    },
    fr: {
        copyFailed:
            'Copie impossible. Sélectionnez le code à la main - le code affiché est bien le vôtre.',
        strayTitle: 'Paiement introuvable',
        strayBody:
            "Aucune commande ne correspond. Si vous avez été débité, contactez l'assistance et nous vérifierons.",
        backToShop: 'Retour à la boutique',
        failedReadTitle: 'Le résultat du paiement est indisponible',
        failedReadBody:
            "Impossible de lire l'état de cette commande. Rechargez la page ; si cela ne suffit pas, contactez l'assistance.",
        checking: 'Vérification de votre paiement...',
        lostTitle: 'Merci - nous vérifions votre paiement',
        lostBody:
            'Si vous avez payé, votre code vous sera envoyé par e-mail dès la confirmation du paiement. Pensez à vérifier vos spams.',
        pendingTitle: 'En attente de la confirmation du paiement',
        pendingBody:
            'Les paiements en cryptomonnaie mettent quelques minutes à être confirmés sur la blockchain. Cette page se met à jour toute seule et le code vous sera aussi envoyé par e-mail - vous pouvez la fermer si besoin.',
        paidTitle: 'Paiement confirmé',
        paidBody: "Voici votre code. Ne fermez pas la page avant de l'avoir enregistré.",
        codeLabel: 'Votre code de carte cadeau',
        copied: 'Copié',
        copy: 'Copier le code',
        another: 'Acheter une autre carte',
        reference: 'Référence',
        paid: 'Payé :',
        price: (receipt: Receipt) => usd(receipt.amount, 'fr'),
        contact: 'E-mail :',
        delivered: 'Le code a été envoyé à cette adresse.',
        notDelivered:
            "L'e-mail n'a pas pu être envoyé, mais ce code est bien le vôtre et il est valable. Copiez-le ici.",
        owedTitle: "Votre paiement est confirmé, mais le code n'est pas prêt",
        owedBody:
            "Votre paiement a abouti et votre commande est enregistrée, mais cette carte s'est épuisée à ce moment-là. Contactez l'assistance avec la référence ci-dessous : nous vous enverrons un code ou vous rembourserons intégralement.",
        cancelledTitle: 'Paiement annulé',
        cancelledBody: "Vous n'avez pas été débité. Réessayez quand vous voulez.",
        tryAgain: 'Réessayer',
        failedTitle: 'Paiement non confirmé',
        failedBody:
            "La facture a expiré ou n'a pas été réglée en totalité. Si vous avez envoyé un paiement, contactez l'assistance et nous réglerons cela."
    },
    tr: {
        copyFailed: 'Kopyalanamadı. Kodu elle seçin - gördüğünüz kod sizindir.',
        strayTitle: 'Bu ödeme bulunamadı',
        strayBody:
            'Bununla eşleşen bir siparişimiz yok. Hesabınızdan ödeme çekildiyse destekle iletişime geçin, inceleyelim.',
        backToShop: 'Mağazaya dön',
        failedReadTitle: 'Ödeme sonucu alınamıyor',
        failedReadBody:
            'Bu siparişin durumunu okuyamadık. Sayfayı yenileyin; sorun devam ederse destekle iletişime geçin.',
        checking: 'Ödemeniz kontrol ediliyor...',
        lostTitle: 'Teşekkürler - ödemenizi kontrol ediyoruz',
        lostBody:
            'Ödeme yaptıysanız, ödeme onaylanır onaylanmaz kodunuz e-postayla gönderilecek. Spam klasörünüzü de kontrol edin.',
        pendingTitle: 'Ödemenizin onaylanması bekleniyor',
        pendingBody:
            'Kripto ödemelerin blokzincirde onaylanması birkaç dakika sürer. Bu sayfa kendiliğinden güncellenir ve kod ayrıca e-postanıza gönderilir - gerekirse sayfayı kapatabilirsiniz.',
        paidTitle: 'Ödeme onaylandı',
        paidBody: 'Kodunuz bu. Kaydetmeden sayfayı kapatmayın.',
        codeLabel: 'Hediye kartı kodunuz',
        copied: 'Kopyalandı',
        copy: 'Kodu kopyala',
        another: 'Başka bir kart al',
        reference: 'Referans',
        paid: 'Ödenen:',
        price: (receipt: Receipt) => usd(receipt.amount, 'tr'),
        contact: 'E-posta:',
        delivered: 'Kod bu adrese e-postayla gönderildi.',
        notDelivered: 'E-posta gönderilemedi, ancak bu kod sizin ve geçerli. Buradan kopyalayın.',
        owedTitle: 'Ödemeniz onaylandı, ancak kod hazır değil',
        owedBody:
            'Ödemeniz gerçekleşti ve siparişiniz kaydedildi, ancak bu kart o anda tükendi. Aşağıdaki referansla destekle iletişime geçin: size bir kod gönderelim ya da ödemenizin tamamını iade edelim.',
        cancelledTitle: 'Ödeme iptal edildi',
        cancelledBody: 'Hesabınızdan ödeme alınmadı. Dilediğiniz zaman tekrar deneyin.',
        tryAgain: 'Tekrar dene',
        failedTitle: 'Ödeme onaylanmadı',
        failedBody:
            'Faturanın süresi doldu ya da tam ödenmedi. Ödeme gönderdiyseniz destekle iletişime geçin, sorunu çözelim.'
    }
};

/** What a NOWPayments payment id looks like. Anything else is not sent. */
const PAYMENT_ID = /^\d{1,20}$/;

/**
 * The payment id NOWPayments sent the buyer back with, or ''. It is read from the query, and
 * from after the `#` too: the return address ends in `#purchase`, and a parameter appended
 * to it lands there.
 */
function returnedPaymentId(params: URLSearchParams): string {
    const fromHash = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('NP_id');
    const found = params.get('NP_id') ?? fromHash ?? '';
    return PAYMENT_ID.test(found) ? found : '';
}

export default function PurchaseResult(): ReactNode {
    const [params, setParams] = useSearchParams();
    const notify = useToasts();
    const lang = useLang();
    const t = useCopy(COPY);

    const token = params.get('receipt') ?? '';
    const strayCallback = params.get('pay') === 'unknown';

    // Back from NOWPayments, with the token in storage rather than on the address. `lost` is the
    // same return when storage had nothing - another device, a private window.
    const returned = shopOf(lang) === 'dollar' && params.get('pay') === 'return';
    const [lost, setLost] = useState(false);

    // NOWPayments puts the buyer's payment id on the way back as `NP_id`. It is carried along
    // as `payment` and handed to the server with the receipt, which checks it with NOWPayments
    // before it believes it - the way an order whose IPN never arrived still finds its payment.
    const payment = params.get('payment') ?? '';
    const paymentHint = PAYMENT_ID.test(payment) ? payment : '';

    useEffect(() => {
        if (!returned || token !== '') {
            return;
        }
        const recalled = recallReceipt();
        if (recalled === '') {
            setLost(true);
            return;
        }
        const returnedWith = returnedPaymentId(params);
        setParams(
            returnedWith === ''
                ? { receipt: recalled }
                : { receipt: recalled, payment: returnedWith },
            { replace: true }
        );
    }, [returned, token, params, setParams]);

    // undefined while unknown, null once we know there is nothing to show.
    const [receipt, setReceipt] = useState<Receipt | null | undefined>(undefined);
    const [receiptFailed, setReceiptFailed] = useState(false);
    const [copied, setCopied] = useState(false);

    // The reset timer is tracked so unmounting cancels it. Left alone, a panel that goes away
    // within two seconds of a copy still fires a write into a component that is gone.
    const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(copyTimer.current), []);

    useEffect(() => {
        if (token === '') {
            return;
        }
        let current = true;
        let poll: ReturnType<typeof setTimeout> | undefined;
        setReceipt(undefined);
        setReceiptFailed(false);

        const read = (): void => {
            client.pay
                .receipt({
                    query: paymentHint === '' ? { token } : { token, payment: paymentHint }
                })
                .then((value) => {
                    if (!current) {
                        return;
                    }
                    setReceipt(value);
                    if (value.outcome === 'pending') {
                        poll = setTimeout(read, POLL_MS);
                    } else {
                        // Settled: this tab is no longer waiting on anything.
                        forgetReceipt();
                    }
                })
                .catch(() => {
                    if (current) {
                        setReceiptFailed(true);
                    }
                });
        };
        read();

        // A second token arriving before the first answer would otherwise land out of order.
        return () => {
            current = false;
            clearTimeout(poll);
        };
    }, [token, paymentHint]);

    const startOver = (): void => {
        setReceipt(undefined);
        setReceiptFailed(false);
        setLost(false);
        setParams({}, { replace: true });
    };

    const copyCode = async (code: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(code);
            // The confirmation stays ON the button rather than in a toast: the reader's eye
            // is already there, and a notice in the corner of the screen would be further
            // from the action than the action itself.
            setCopied(true);
            clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            // A refused clipboard is the one case worth a notice - the button would
            // otherwise say nothing at all and the buyer would assume the code was taken.
            notify.error(t.copyFailed);
        }
    };

    if (token === '' && !strayCallback && !lost) {
        return null;
    }

    const support = (
        <p className="mt-2 text-small">
            <span dir="ltr" className="latin">
                {CONTACT.phone}
            </span>
        </p>
    );

    return (
        <section id="purchase" className="mx-auto max-w-3xl scroll-mt-20 px-4 pt-section sm:px-5">
            <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
                {strayCallback && (
                    <>
                        <h2 className="font-bold">{t.strayTitle}</h2>
                        <p className="mt-3 text-small text-muted">{t.strayBody}</p>
                        <Button className="mt-5" onClick={startOver}>
                            {t.backToShop}
                        </Button>
                    </>
                )}

                {lost && token === '' && (
                    <>
                        <div className="flex items-center gap-2 text-firouze">
                            <Clock className="size-5" aria-hidden="true" />
                            <h2 className="font-bold">{t.lostTitle}</h2>
                        </div>
                        <p className="mt-3 text-small text-muted">{t.lostBody}</p>
                        <Button className="mt-5" onClick={startOver}>
                            {t.backToShop}
                        </Button>
                    </>
                )}

                {!strayCallback && receiptFailed && (
                    <>
                        <h2 className="font-bold">{t.failedReadTitle}</h2>
                        <p className="mt-3 text-small text-muted">{t.failedReadBody}</p>
                        {support}
                    </>
                )}

                {!strayCallback && !receiptFailed && token !== '' && receipt === undefined && (
                    <p className="text-small text-muted">{t.checking}</p>
                )}

                {receipt?.outcome === 'pending' && (
                    <>
                        <div className="flex items-center gap-2 text-firouze">
                            <Clock className="size-5" aria-hidden="true" />
                            <h2 className="font-bold">{t.pendingTitle}</h2>
                        </div>
                        <p className="mt-3 text-small text-muted">{t.pendingBody}</p>
                        <div className="anim-pulse mt-5 h-2 rounded-full bg-firouze/30"></div>
                    </>
                )}

                {receipt?.outcome === 'paid' && receipt.code !== null && (
                    <>
                        <div className="flex items-center gap-2 text-firouze">
                            <ShieldCheck className="size-5" aria-hidden="true" />
                            <h2 className="font-bold">{t.paidTitle}</h2>
                        </div>
                        <p className="mt-2 text-small text-muted">{t.paidBody}</p>

                        <div className="mt-5">
                            <CodeCapsule code={receipt.code} label={t.codeLabel} verified />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-3">
                            <Button
                                variant="primary"
                                glyph={copied ? Check : Copy}
                                onClick={() => void copyCode(receipt.code ?? '')}
                            >
                                {copied ? t.copied : t.copy}
                            </Button>
                            <Button onClick={startOver}>{t.another}</Button>
                        </div>

                        <dl className="mt-6 grid gap-2 text-caption text-muted">
                            <div className="flex gap-2">
                                <dt>{t.reference}:</dt>
                                <dd dir="ltr" className="latin">
                                    {String(receipt.refId ?? '-')}
                                </dd>
                            </div>
                            <div className="flex gap-2">
                                <dt>{t.paid}</dt>
                                <dd>{t.price(receipt)}</dd>
                            </div>
                            <div className="flex gap-2">
                                <dt>{t.contact}</dt>
                                <dd dir="ltr" className="latin min-w-0 text-end break-all">
                                    {receipt.phone}
                                </dd>
                            </div>
                        </dl>

                        <p className="mt-4 text-caption text-muted">
                            {receipt.smsDelivered ? t.delivered : t.notDelivered}
                        </p>
                    </>
                )}

                {/* Money verified, nothing left to hand over. Saying "successful" and showing
                    no code would be worse than useless, so this state says what happened. */}
                {receipt?.outcome === 'paid' && receipt.code === null && (
                    <>
                        <div className="flex items-center gap-2 text-gold">
                            <TriangleAlert className="size-5" aria-hidden="true" />
                            <h2 className="font-bold">{t.owedTitle}</h2>
                        </div>
                        <p className="mt-3 text-small text-muted">{t.owedBody}</p>
                        <div className="mt-4 rounded-xl border border-line bg-paper p-4">
                            <p className="text-caption text-muted">{t.reference}</p>
                            <p dir="ltr" className="latin mt-1 text-start text-lg font-semibold">
                                {String(receipt.refId ?? '-')}
                            </p>
                        </div>
                        {support}
                    </>
                )}

                {receipt?.outcome === 'cancelled' && (
                    <>
                        <h2 className="font-bold">{t.cancelledTitle}</h2>
                        <p className="mt-3 text-small text-muted">{t.cancelledBody}</p>
                        <Button variant="primary" className="mt-5" onClick={startOver}>
                            {t.tryAgain}
                        </Button>
                    </>
                )}

                {receipt?.outcome === 'failed' && (
                    <>
                        <h2 className="font-bold">{t.failedTitle}</h2>
                        <p className="mt-3 text-small text-muted">{t.failedBody}</p>
                        {support}
                        <Button className="mt-5" onClick={startOver}>
                            {t.tryAgain}
                        </Button>
                    </>
                )}
            </div>
        </section>
    );
}
