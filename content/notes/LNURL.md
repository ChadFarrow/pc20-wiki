---
type: protocol
status: seed
tags: [lightning]
related: ["[[Lightning Address]]", "[[Lightning Network]]", "[[Lightning Invoice]]"]
---

# LNURL

LNURL is a set of protocols that wrap Lightning interactions in ordinary HTTP requests, so wallets can fetch what they need instead of making users copy long strings.

## Why it matters

Raw Lightning UX is hostile: [[Lightning Invoice|invoices]] expire, are single-use, and are unreadable. LNURL puts a server in the middle that mints them on demand, which is the foundation of anything resembling a reusable payment identity.

The cost is a server. An invoice is a message between two nodes; an LNURL is a promise that a web endpoint will still answer tomorrow. The identity is only as durable as whoever runs that host.

## How it works

The specifications are numbered LUDs. LUD-01 defines the base encoding — an HTTPS URL in bech32, which is the `lnurl1…` string a QR code carries. LUD-17 allows the raw URL with a scheme prefix instead, which is what most modern wallets use.

The subprotocols cover the common flows: LUD-06 for pay, LUD-03 for withdraw, LUD-04 for auth, LUD-02 for channel requests. In LUD-06 the wallet fetches the URL and receives a callback address, a minimum and maximum amount, and a `metadata` string that must contain a `text/plain` entry. The wallet then calls back with a chosen amount and receives an invoice whose description hash commits to that exact metadata, so the wallet can prove the invoice matches what it was shown.

LUD-09 adds a success message after payment, LUD-12 a comment field, and LUD-16 the static identifier behind a [[Lightning Address]].

## Related

- [[Lightning Address]] — LNURL-pay behind an email-shaped identifier

## Sources

- https://github.com/lnurl/luds
