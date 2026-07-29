// The two fields both halves of the contract need. Everything else lives with the feature
// that owns it - see pay.ts and admin.ts.
import { number } from '@azerothjs/schema';

/**
 * A denomination, in dollars. This USED to be `union([literal(5), literal(10), literal(25)])`,
 * which made "an unlisted amount is a forged request" a compile-time and wire-time fact.
 *
 * The catalogue is editable now, so the valid set is a database table and the schema can only
 * check the shape. THE RULE DID NOT GO AWAY WITH THE TYPE: `pay.start` looks the amount up in
 * the live tier table and refuses anything missing or inactive, before a code is claimed or a
 * gateway is called. Read that handler alongside this line - it is where the union went.
 */
export const amountField = number({ int: true, min: 1, max: 100_000 });

/** The same field arriving through a query string, where everything is text. */
export const amountQueryField = number({ int: true, min: 1, max: 100_000, coerce: true });
