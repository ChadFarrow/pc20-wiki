---
type: tool
status: seed
tags: [podcasting, lightning]
related: ["[[Boostagram]]", "[[BoostBox]]", "[[Value 4 Value]]"]
---

# MetaBoost

MetaBoost is an API for storing and retrieving payment metadata, built to be indifferent to which payment network the payment itself used.

## Why it matters

[[Value 4 Value]] tooling has largely assumed Lightning, so the metadata formats assumed Lightning too. Treating the payload as ordinary JSON with a declared `type` lets the same store hold a Lightning boost and a Monero payment without a second system.

## How it works

Payment data is stored as a JSON object with whatever fields the sender needs, plus an optional cryptographic signature over the payload. Records are addressed and fetched back by reference. It solves roughly the problem [[BoostBox]] solves, with a wider notion of what counts as a payment.

## Open questions

- Two overlapping metadata services now exist; does the ecosystem converge on one or keep both

## Sources

- https://podcasting2.org/docs/podcast-namespace/examples/value/blip-0010
