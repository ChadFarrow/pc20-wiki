---
type: concept
status: seed
element: Boostagrams
tags: [podcasting, v4v, lightning]
related: ["[[Value 4 Value]]", "[[Boostagram]]", "[[Streaming Sats]]"]
---

# Boost

A boost is a deliberate one-off payment a listener sends to a show, as opposed to the sats that flow automatically while the episode plays.

## Why it matters

The boost is the moment [[Value 4 Value]] stops being ambient and becomes a signal. Streaming pays for attention; a boost says *this bit, right here, was worth something*, and it usually carries a message saying why — see [[Boostagram]].

It is also the closest thing open podcasting has to a like button, except the unit is money rather than engagement, so it cannot be farmed and cannot be faked cheaply.

## How it works

The listener chooses an amount in the app, which divides it by the [[Splits|splits]] in the feed and sends each recipient their share over [[Lightning Network]], typically by [[Keysend]]. The payment carries metadata identifying the podcast, the episode and the playback position, with `action` set to `boost`.

Two amounts travel along: `value_msat`, what a given recipient actually received, and `value_msat_total`, what the listener originally entered — preserved so that a boost of 12,345 sats still reads as 12,345 to everyone who sees it.

## Related

- [[Streaming Sats]] — the automatic counterpart

## Sources

- https://podcasting2.org/docs/podcast-namespace/examples/value/blip-0010
