---
type: protocol
status: seed
tags: [lightning]
related: ["[[Lightning Address]]", "[[Lightning Network]]"]
---

# LNURL

LNURL is a set of protocols that wrap Lightning interactions in ordinary HTTP requests, so wallets can fetch what they need instead of making users copy long strings.

## Why it matters

Raw Lightning UX is hostile: invoices expire, are single-use, and are unreadable. LNURL puts a server in the middle that mints them on demand, which is the foundation of anything resembling a reusable payment identity.

## How it works

Subprotocols cover the common flows — pay, withdraw, auth, channel. In LNURL-pay, the wallet fetches a URL, receives payment parameters and limits, then requests an invoice for a chosen amount. A success action can return a message or URL after payment completes.

## Related

- [[Lightning Address]] — LNURL-pay behind an email-shaped identifier
