---
type: tool
status: seed
tags: [podcasting, lightning]
related: ["[[Boostagram]]", "[[Boost]]", "[[Lightning Invoice]]", "[[Value 4 Value]]"]
---

# BoostBox

BoostBox is a self-hostable API that stores Podcasting 2.0 payment metadata and hands back a short URL to reference it by.

## Why it matters

Boost metadata normally travels inside the payment itself, which caps how much can be sent and couples the message to the transport. Putting the payload somewhere addressable and sending only a link keeps the full [[Boostagram]] intact no matter how constrained the payment path is.

## How it works

An app POSTs the complete JSON metadata payload to the `/boost` endpoint and receives a short, stable URL. That URL goes into the [[Lightning Invoice]] description, so the link to the original metadata survives alongside the payment. It implements a developing standard for transmitting payment metadata via HTTP headers, proposed as podcast-namespace PR #734.

## Open questions

- A hosted URL is a dependency the payment does not have: what happens to the metadata when the box goes away
