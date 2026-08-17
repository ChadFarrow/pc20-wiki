---
type: spec
status: growing
tags: [podcasting, spec]
related: ["[[RSS]]", "[[Value 4 Value]]"]
---

# Podcast Namespace

The podcast namespace is a set of XML tags that extend [[RSS]] with podcast-specific capabilities the original spec never anticipated.

## Why it matters

It is the extension point where every [[Podcasting 2.0]] feature actually lands. Arguing about a feature means arguing about a tag, in the open, in a public repo — a very different process than a platform shipping something proprietary.

## How it works

Publishers declare the namespace on the feed's root element, then use prefixed tags like `<podcast:value>`, `<podcast:transcript>`, `<podcast:chapters>`, `<podcast:person>`, and `<podcast:socialInteract>`. Clients that do not understand a tag skip it, so feeds stay backward compatible.

Tags move through a proposal process: discussion, then a phase designation reflecting how settled the tag is. Later phases mean more stability and more real implementations.

## Related

- [[Value 4 Value]] — the `<podcast:value>` block
- [[Lightning Address]] — one recipient type inside that block

## Sources

- https://podcasting2.org/docs/podcast-namespace
