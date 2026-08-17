---
type: tool
status: seed
tags: [podcasting, lightning, dev]
related: ["[[Keysend]]", "[[Boostagram]]", "[[LND]]"]
---

# extractlv

extractlv is a small set of Python tools for pulling TLV records out of a Lightning node and doing something useful with them.

## Why it matters

Podcasting 2.0 payments carry their meaning in TLV records rather than in the payment amount, so any tool that wants to know who boosted, on which episode, with what message has to read those records first. This was one of the early demonstrations that the data was there and could be extracted.

## How it works

It talks to an [[LND]] node over gRPC and reads the custom TLV records attached to [[Keysend]] payments, exposing the [[Boostagram]] payload underneath.

## Open questions

- The repo has been dormant since 2021; treat it as a reference implementation rather than something to deploy

## Sources

- https://podcasting2.org/docs/podcast-namespace/examples/value/blip-0010
