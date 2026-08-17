---
type: spec
status: growing
tags: [lightning, v4v]
related: ["[[LNURL]]", "[[Value 4 Value]]"]
---

# Lightning Address

A Lightning Address is an email-shaped identifier like `name@domain.com` that resolves to an [[LNURL]]-pay endpoint, giving a person a reusable, memorable way to receive sats.

## Why it matters

It is the difference between "here is my payment identity" and "here is a fresh invoice, hurry." For [[Value 4 Value]] recipients it means a feed can name a payee in a form humans can read and verify.

## How it works

The local part and domain are rewritten into a well-known HTTPS path on that domain. A wallet fetches it, gets LNURL-pay parameters back, and requests an invoice. No new protocol — a naming convention plus a resolution rule on top of existing pieces.

Running one yourself means a domain, TLS, and something that mints invoices, which is where [[LNbits]] usually enters.

## Related

- [[LNbits]]
