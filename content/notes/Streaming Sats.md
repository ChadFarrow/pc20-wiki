---
type: concept
status: seed
tags: [podcasting, v4v, lightning]
related: ["[[Value 4 Value]]", "[[Boost]]", "[[Sats]]"]
---

# Streaming Sats

Streaming sats are payments sent continuously while an episode plays — typically once a minute, split among the recipients named in the feed — without the listener doing anything.

## Why it matters

This is the mechanic that makes [[Value 4 Value]] a model rather than a tip jar. Support scales with attention actually given: a listener who finishes a two-hour episode pays more than one who bails at minute three, and neither had to decide anything.

It is also the requirement that shaped the rest of the stack. Paying four people every sixty seconds is why [[Keysend]] exists in podcast apps at all — asking four servers for a fresh [[Lightning Invoice|invoice]] each minute is not a workable design.

## How it works

The listener sets a rate — say 10 [[Sats|sats]] per minute — in the app. Each interval the app divides that by the [[Splits|splits]] declared in the `<podcast:value>` block and sends each recipient their share, tagged with `action` set to `stream`.

Amounts are tracked internally in millisats, because a recipient holding a 2% split of 10 sats per minute is owed a fraction of a sat and the arithmetic has to survive it. Stream payments should carry no message; that is what a [[Boost|boost]] is for.

## Open questions

- Failed payments are largely invisible to the listener, who has no way to tell streaming from silently not working
