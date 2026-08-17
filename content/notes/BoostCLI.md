---
type: tool
status: seed
tags: [podcasting, lightning, dev]
related: ["[[Boost]]", "[[Value 4 Value]]", "[[RaspiBlitz]]", "[[Podcast Index]]"]
---

# BoostCLI

BoostCLI is a command line tool for sending and reviewing Podcasting 2.0 value payments without a podcast app in the way.

## Why it matters

Boosting is normally something an app does on your behalf, which makes it hard to test what a feed's value block actually resolves to. A command line path — `boostcli boost <feed-url>` — turns [[Value 4 Value]] into something scriptable and inspectable.

## How it works

It reads the value block out of a podcast feed, resolves the recipients, and sends the [[Boost]] through a connected node. It is written in Python and expects a [[RaspiBlitz]] node.

## Open questions

- Last released in 2024 and node support is narrow; how much still works against current setups

## Sources

- https://podcasting2.org/docs/podcast-namespace/tags/value
