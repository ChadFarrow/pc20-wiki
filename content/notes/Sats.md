---
type: concept
status: seed
tags: [bitcoin, lightning]
related: ["[[Bitcoin]]", "[[Streaming Sats]]"]
---

# Sats

A sat, short for satoshi, is the smallest unit of [[Bitcoin]] — one hundred millionth of a coin — and the unit everything in podcast payments is actually denominated in.

## Why it matters

Pricing in whole bitcoin makes micropayments unreadable: nobody wants to send 0.00000005 of anything. Sats turn the same amount into "five sats," which is the difference between a number a listener can reason about and one they cannot.

It also sets the scale of [[Value 4 Value]]. A show earning a few thousand sats an episode is earning a few dollars — the model only adds up across a lot of listeners, or a few generous ones.

## How it works

One bitcoin is 100,000,000 sats. [[Lightning Network]] goes finer still, accounting internally in millisats — thousandths of a sat — which is what makes per-minute streaming arithmetic work without rounding everything to zero. The `<podcast:value>` block's `suggested` attribute is denominated in bitcoin, so feeds carry values like `0.00000005000` that apps convert to sats for display.

## Related

- [[Streaming Sats]] — sats sent continuously while audio plays
- [[Boost]] — sats sent deliberately, in a lump
