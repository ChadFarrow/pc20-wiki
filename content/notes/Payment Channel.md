---
type: concept
status: seed
tags: [lightning, bitcoin]
related: ["[[Lightning Network]]", "[[Liquidity]]", "[[LND]]"]
---

# Payment Channel

A payment channel is a two-party balance, opened by locking [[Bitcoin]] on-chain, that the two parties can rebalance between themselves as often as they like and settle only once.

## Why it matters

The channel is what makes a one-sat payment sane. Moving value inside a channel costs nothing on-chain, so the economics that make [[Bitcoin]] unsuitable for micropayments stop applying — which is the entire premise of streaming sats to a podcast.

It is also where the operational pain lives. Channels are the thing you have to open, fund, monitor, rebalance and eventually close, and the reason running [[LND]] is a commitment rather than an install.

## How it works

Two parties commit funds in an on-chain transaction, then exchange signed updates that each supersede the last. Either can close the channel by publishing the latest state; publishing an old one is punishable, which is what keeps both honest.

Payments route across chains of channels, so a payer needs a path to the payee, not a direct channel with them.

## Related

- [[Liquidity]] — which direction a channel's balance can actually move
- [[Custody]] — the alternative to running channels at all
