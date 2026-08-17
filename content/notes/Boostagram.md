---
type: spec
status: seed
element: Boostagrams
tags: [podcasting, v4v, lightning]
related: ["[[Boost]]", "[[Keysend]]", "[[Value 4 Value]]"]
---

# Boostagram

A boostagram is the message a listener attaches to a [[Boost|boost]], carried inside the payment itself rather than posted to any platform.

## Why it matters

It is the only part of [[Value 4 Value]] that travels back up the wire as words. There is no comment box, no account, and nothing to moderate away — the message arrives because the money did, which makes spam expensive by construction.

For a podcaster it is also the clearest feedback signal in the medium: someone paid to say this, at this timestamp.

## How it works

Podcast metadata rides along with the payment in a TLV record — type `7629169` — attached to the Lightning payment, as defined by bLIP-10. The value is JSON identifying the show (`podcast`, `guid`, `feedID` or `url`, with guid preferred), the episode, the playback position in `ts`, the sending app in `app_name`, the listener's chosen name in `sender_name`, and the text in `message`.

The same record carries `action`, which distinguishes a `boost` from a `stream` or an `auto` payment. Streams should not carry a message; boosts and auto payments may.

Because it is a custom record on a [[Keysend]] payment, any node that receives the payment receives the message with it.

## Sources

- bLIP-10: https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/examples/value/blip-0010.md
