---
type: protocol
status: seed
tags: [lightning, v4v]
related: ["[[Lightning Network]]", "[[Value 4 Value]]"]
---

# Keysend

Keysend is a Lightning payment method that lets a sender push sats to a node's public key without the recipient first generating an invoice.

## Why it matters

Streaming payments cannot ask for an invoice every minute. Keysend removes the request-response handshake, which is exactly what a podcast app needs while audio plays in the background.

## How it works

The sender includes the payment preimage inside the encrypted onion payload rather than learning it from an invoice. The receiving node extracts it and settles. Custom records travel in the same payload, which is how boostagram messages ride along with a payment.

## Related

- [[Lightning Address]] — the more human-friendly alternative
