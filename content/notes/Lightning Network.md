---
type: protocol
status: growing
tags: [bitcoin, lightning]
related: ["[[Keysend]]", "[[Value 4 Value]]"]
---

# Lightning Network

Lightning is a payment layer on top of Bitcoin that settles transactions between parties off-chain, making small, fast payments economically viable.

## Why it matters

On-chain Bitcoin cannot carry a one-sat payment: fees and block time make it absurd. Lightning is what makes streaming sats per minute — the mechanic underneath [[Value 4 Value]] — possible at all.

## How it works

Two parties open a payment channel by committing funds on-chain, then update the balance between them privately, as often as they like, settling on-chain only when the channel closes. Payments route across chains of channels, so a payer needs no direct channel with a payee.

The recurring practical problem is liquidity: receiving requires inbound capacity, which is why new nodes can pay easily and struggle to get paid.

## Related

- [[LND]] — a common node implementation
- [[LNURL]] — protocol layer for friendlier payment flows
