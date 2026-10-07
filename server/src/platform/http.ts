// The failures a handler is allowed to throw, and the one envelope they all cross the wire
// in.
//
// A handler throws; nothing in a feature builds an error response by hand. That is what
// makes the shape uniform - `{ error: { code, message, details } }` - and it is the shape
// `platform/contract.ts` parses back into an `ApiError` on the client, so a page can read
// `status`, `message` and a field map without knowing which route it called.
//
// The MESSAGES ARE PERSIAN because they are shown to the reader. A message here is copy, not
// a developer note; anything a developer needs goes to the log instead.

/** Extra structure beside the message. Sent as it is, so nothing goes in here by accident. */
export interface ErrorDetails {
    /** A per-field message map, for a form to mark the input that was refused. */
    fields?: Record<string, string>;

    /**
     * THE ONE EXCEPTION to "a developer's note goes to the log": why it failed, in plain
     * English, for the browser console of somebody running the shop. A handler attaches it
     * ONLY for a request it has proven comes from the operator - see `start` in
     * features/checkout/routes.ts - because it describes how this installation is configured.
     */
    reason?: string;
}

export interface HttpErrorOptions {
    /** A stable machine-readable tag. The client passes it through untouched. */
    code?: string;

    details?: ErrorDetails;

    /** Seconds. Sent as `Retry-After` so a well-behaved client knows when to return. */
    retryAfter?: number;
}

/** The base every refusal derives from. A thrown one becomes its status; anything else is a 500. */
export class HttpError extends Error {
    public readonly status: number;
    public readonly code: string;
    public readonly details?: ErrorDetails;
    public readonly retryAfter?: number;

    constructor(status: number, message: string, options: HttpErrorOptions = {}) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.code = options.code ?? 'error';
        this.details = options.details;
        this.retryAfter = options.retryAfter;
    }
}

/**
 * The request did not survive its schema. 422 rather than 400: the body parsed as JSON
 * perfectly well, it just said something the contract does not allow - and the field map is
 * what the form displays against its inputs.
 */
export class ValidationError extends HttpError {
    constructor(fields: Record<string, string>, message = 'اطلاعات وارد شده درست نیست') {
        super(422, message, { code: 'validation', details: { fields } });
        this.name = 'ValidationError';
    }
}

/** No live session, or a credential that did not match. Never says which. */
export class UnauthorizedError extends HttpError {
    constructor(message = 'برای این بخش باید وارد شوید') {
        super(401, message, { code: 'unauthorized' });
        this.name = 'UnauthorizedError';
    }
}

/** The request was understood and refused: sold out, not for sale, wrong shape of key. */
export class ConflictError extends HttpError {
    constructor(message: string) {
        super(409, message, { code: 'conflict' });
        this.name = 'ConflictError';
    }
}

/** Nothing to report. Used where "no such thing" and "not yours to see" must look identical. */
export class NotFoundError extends HttpError {
    constructor(message = 'چیزی پیدا نشد') {
        super(404, message, { code: 'not-found' });
        this.name = 'NotFoundError';
    }
}

/** Too many, too fast. `retryAfter` is the whole point - a bare 429 tells a client nothing. */
export class TooManyRequestsError extends HttpError {
    constructor(
        retryAfter: number,
        message = 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.'
    ) {
        super(429, message, { code: 'rate-limited', retryAfter });
        this.name = 'TooManyRequestsError';
    }
}
