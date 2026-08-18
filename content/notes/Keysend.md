---
type: protocol
status: seed
tags: [lightning, v4v]
related: ["[[Lightning Network]]", "[[Value 4 Value]]", "[[Boostagram]]"]
---

# Keysend

Keysend is a Lightning payment method that lets a sender push [[Sats|sats]] to a node's public key without the recipient first generating [[Lightning Invoice|an invoice]].

## Why it matters

Streaming payments cannot ask for an invoice every minute. Keysend removes the request-response handshake, which is exactly what a podcast app needs while audio plays in the background.

The tradeoff is that nothing was agreed in advance. A normal invoice is a request the payer answers, so it doubles as a receipt. A keysend payment arrives unannounced, with no proof that ties it to anything the recipient asked for.

## How it works

Normally the payer learns the payment preimage only when the invoice is settled. Keysend inverts that: the sender generates the preimage, encrypts it inside the onion payload addressed to the destination, and sends the payment. The receiving node extracts the preimage from custom record type `5482373484` and settles against it.

Because the payload is already a set of TLV records, other records ride along in the same onion. That is the mechanism behind [[Boostagram|boostagrams]] — the podcast metadata travels in record `7629169` on the same payment.

The receiving node must opt in. LND, for example, refuses these payments unless keysend is explicitly enabled, since accepting them means settling an invoice it never issued.

## Related

- [[Lightning Address]] — the more human-friendly alternative

## Sources

- https://podcasting2.org/docs/podcast-namespace/examples/value/blip-0010
- https://github.com/lightningnetwork/lnd/blob/master/record/experimental.go
