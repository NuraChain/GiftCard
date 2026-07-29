// Stamps the shop's configured name into the HTML the browser receives.
//
// WHY THIS EXISTS. The name lives in the database, but the `<title>` and the first paint come
// from the built shell, which was written before anyone chose a name. Without this, a shop
// that renamed itself served the OLD name in the tab and in the header until the catalogue
// fetch landed and the client swapped it - a visible flash of the wrong brand, and a title
// that a crawler would index wrongly because crawlers do not wait for a fetch.
//
// It is an edge wrapper rather than a route because it applies to every page the kit serves,
// including ones added later, and because a wrapper is the one place that can see a response
// after it has been rendered.
import type { HandlerWrapper } from '@azerothjs/http';

import type { Settings } from '../features/settings/settings.ts';

/** @internal Text going into an HTML attribute or element - never trusted, always escaped. */
function escapeHtml(value: string): string
{
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Rewrites `<title>` and adds `<meta name="app-name">` on HTML responses.
 *
 * The meta is what lets the client render the right name on its FIRST paint: reading it is
 * synchronous, where the catalogue fetch is not.
 */
export function brandPages(settings: Settings): HandlerWrapper
{
    return (next) => ({
        async handle(request: Request): Promise<Response>
        {
            const response = await next.handle(request);
            const type = response.headers.get('content-type') ?? '';
            if (!type.includes('text/html'))
            {
                return response;
            }

            // The operator types this name, so it is UNTRUSTED input on its way into markup.
            // Escaping here is the difference between a shop name and a script tag.
            const name = escapeHtml(settings.current().appName);
            const html = (await response.text())
                .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${ name } - خرید گیفت کارت</title>`)
                .replace('</head>', () => `<meta name="app-name" content="${ name }"/></head>`);

            const headers = new Headers(response.headers);
            // The body length changed, so a copied content-length would truncate the page.
            headers.delete('content-length');
            return new Response(html, { status: response.status, statusText: response.statusText, headers });
        }
    });
}
