---
type: tool
status: seed
tags: [podcasting, lightning]
related: ["[[Splits]]", "[[Boost]]", "[[Keysend]]", "[[Sovereign Feeds]]"]
---

# Split Box

Split Box is a REST server that stores TLV records and forwards received boosts on to the splits declared in a podcaster's feed.

## Why it matters

[[Splits]] declare who gets what, but somebody still has to do the paying. When a listener's app sends one payment, the recipients named in the feed only get their share if something downstream fans it out — and that logic has to live somewhere other than every individual app.

## How it works

The server accepts and stores TLV records, reads the split declarations from the feed, and forwards the appropriate shares. The client is deliberately decoupled from the server so any frontend can drive it; the reference client is Svelte. The intended path is a feed tag pointing at a box, added through [[Sovereign Feeds]], with apps like [[LNBeats]] posting to that URL when the tag is present.

## Open questions

- Forwarding means the box briefly holds other people's money — see [[Custody]]
