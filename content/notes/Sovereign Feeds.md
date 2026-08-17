---
type: tool
status: seed
tags: [podcasting, rss]
related: ["[[RSS]]", "[[Podcast Namespace]]", "[[Chapters]]", "[[Value 4 Value]]"]
---

# Sovereign Feeds

Sovereign Feeds is a web tool for creating and hosting a Podcasting 2.0 feed without hand-writing the XML.

## Why it matters

The [[Podcast Namespace]] is only useful to a publisher who can actually emit it, and most hosting companies expose whichever tags they chose to support. A tool that writes the feed directly puts the choice back with the podcaster — including tags no host has adopted yet.

## How it works

It is a SvelteKit app at sovereignfeeds.com that builds and serves the [[RSS]] feed, with editors for namespace features such as [[Chapters]] and the value block behind [[Value 4 Value]], plus tutorials for publishers new to the tags.

## Open questions

- Self-published feeds move the hosting problem rather than removing it: what is the durability story

## Sources

- https://podcasting2.org/docs/podcast-namespace
