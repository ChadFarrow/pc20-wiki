---
type: concept
status: growing
tags: [podcasting]
related: ["[[Podcast Namespace]]", "[[Podcast Index]]", "[[Value 4 Value]]"]
---

# Podcasting 2.0

Podcasting 2.0 is an effort to extend open podcasting with modern features — payments, transcripts, chapters, cross-app comments — without routing any of it through a central platform.

## Why it matters

By the late 2010s the interesting features in podcasting were arriving as platform exclusives. Podcasting 2.0 is the counterargument: extend the open spec instead, so any app can implement any feature and no gatekeeper accumulates leverage.

## How it works

Three pieces sit together. [[Podcast Namespace]] defines new XML tags. [[Podcast Index]] provides an open directory so apps have something to search. [[Podping]] handles real-time update notification. Individual features — [[Value 4 Value]] payments, transcripts, chapters, soundbites, cross-app comments — are namespace tags that apps opt into.

## Open questions

- Adoption is uneven: a tag in the spec is not a tag in the apps
- How much complexity can a feed absorb before publishing tools become the bottleneck
