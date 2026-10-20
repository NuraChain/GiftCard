# Redeem API

Cashes a sold gift code out to a USDT wallet. The caller is a wallet app (Nura Wallet), which
sends the code the holder typed in, together with the holder's address.

The route **records** the redemption and notifies the operator over Telegram and SMS. It does
**not** send any money: the operator makes the transfer by hand. A `200` means "the code is
spent and the payout is queued", not "paid".

## Request

```
POST /api/redeem
Content-Type: application/json
```

No session, cookie or API key. Whoever holds the code can redeem it, once.

| Field            | Type   | Required | Notes                                                                                        |
| ---------------- | ------ | -------- | -------------------------------------------------------------------------------------------- |
| `code`           | string | yes      | The gift code, a 36-character UUID. Case and surrounding whitespace are ignored.             |
| `wallet_address` | string | one of   | Destination address. The name Nura Wallet uses.                                              |
| `wallet`         | string | one of   | The same destination under the older name. Send one of the two, or both with the same value. |

### Addresses

The network is worked out from the address. There is no network field.

| Network | Shape                                    | Check                                                                              |
| ------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `TRC20` | `T` + 33 base58 characters (34 in total) | Full base58check, so a mistyped character is refused **before** the code is spent. |
| `ERC20` | `0x` + 40 hex characters                 | Shape only. EIP-55 is not verified here, so the letter case is kept as sent.       |

Invisible characters (zero-width and bidi marks that come with text pasted from Telegram) are
removed before the address is checked.

### Rate limit

6 requests per minute per client IP. Going over returns `429` with a `Retry-After` header in
seconds.

## Success: `200 OK`

| Field      | Type    | Meaning                                                                                                                                                    |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `amount`   | integer | The card's value in dollars (USDT owed).                                                                                                                   |
| `network`  | string  | `TRC20` or `ERC20`, worked out from the address.                                                                                                           |
| `wallet`   | string  | The address as it was recorded. Show it so the holder can check it.                                                                                        |
| `at`       | string  | ISO 8601 UTC time the code was spent. The code cannot be used again after this.                                                                            |
| `notified` | boolean | Whether Telegram or SMS reached the operator. `false` still means the code is spent and the request is stored; it only means the transfer may take longer. |

## Errors

Every error has the same envelope:

```json
{
    "error": {
        "code": "validation",
        "message": "Persian text, safe to show the holder",
        "details": { "fields": { "wallet_address": "Persian text for this field" } }
    }
}
```

`details` is only present on `422`. `details.fields` uses the field name the caller sent
(`wallet_address` or `wallet`).

| Status | `error.code`   | When                                                                                                                                  | Code spent?                                                      |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `422`  | `validation`   | Code is not a UUID, address is missing or malformed, TRC20 checksum fails, or `wallet` and `wallet_address` hold different addresses. | No                                                               |
| `404`  | `not-found`    | No such code, or the shop holds it but has not sold it. The two cases get the same answer on purpose.                                 | No                                                               |
| `409`  | `conflict`     | The code was already redeemed. The message includes the original redemption time.                                                     | Already was                                                      |
| `429`  | `rate-limited` | Too many requests. Wait for `Retry-After` seconds.                                                                                    | No                                                               |
| `400`  | `bad-request`  | The body is not valid JSON.                                                                                                           | No                                                               |
| `500`  | `internal`     | Unexpected server failure.                                                                                                            | Unknown; retrying is safe because a code can only be spent once. |

## Example

Request:

```bash
curl -X POST https://shop.example.com/api/redeem \
  -H 'Content-Type: application/json' \
  -d '{
        "code": "3f2b8c1e-9a4d-4e7b-8f21-6c5d0a9e7b14",
        "wallet_address": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
      }'
```

Response, `200 OK`:

```json
{
    "amount": 10,
    "network": "TRC20",
    "wallet": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    "at": "2026-10-20T15:42:07.318Z",
    "notified": true
}
```

The same code sent again, `409 Conflict`:

```json
{
    "error": {
        "code": "conflict",
        "message": "این کد قبلاً استفاده شده است (2026-10-20T15:42:07.318Z). هر کد فقط یک بار قابل برداشت است."
    }
}
```

A mistyped TRC20 address, `422 Unprocessable Entity` (the code is still unspent):

```json
{
    "error": {
        "code": "validation",
        "message": "آدرس کیف پول درست نیست",
        "details": {
            "fields": {
                "wallet_address": "این آدرس درست نیست. دوباره از کیف پول خودتان کپی کنید."
            }
        }
    }
}
```

An unknown or unsold code, `404 Not Found`:

```json
{
    "error": {
        "code": "not-found",
        "message": "این کد معتبر نیست یا هنوز فروخته نشده است."
    }
}
```

The source of truth is `server/src/features/redeem/contract.ts` (shapes) and
`server/src/features/redeem/routes.ts` (rules).
