---
type: tool
status: seed
tags: [podcasting, lightning, music, apps]
related: ["[[Value 4 Value]]", "[[Podcast Index]]", "[[Streaming Sats]]", "[[Boost]]"]
---

# LNBeats

LNBeats is a web player for value-enabled music, built on the Podcast Index and paying artists over Lightning as you listen.

## Why it matters

Music was the first place [[Value 4 Value]] stopped being a podcasting idea and became a distribution model: an artist publishes a feed with a value block and gets paid per listen, with no label or platform in between. LNBeats is the front door for that catalogue.

## How it works

It queries the [[Podcast Index]] API for music feeds — the app requires an API key and secret — and plays them in the browser. Payment happens through the feed's value block, either as [[Streaming Sats]] while a track plays or as a [[Boost]] sent on purpose. It is a SvelteKit app, and runs at lnbeats.com.

## Open questions

- Music feeds and podcast feeds share a namespace but not a listening pattern

## Sources

- https://podcasting2.org/docs/podcast-namespace/tags/medium
