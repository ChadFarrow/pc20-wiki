---
type: moc
status: growing
tags: [moc, podcasting]
---

# Podcasting 2.0 MOC

Map of the open podcasting stack: the feed format underneath it, the namespace extending it, and the index that makes it discoverable.

## Start here

- [[Podcasting 2.0]] — the movement and what it is reacting to
- [[RSS]] — the substrate everything else extends

## Core concepts

- [[Podcast Namespace]]
- [[Podcast Index]]
- [[Podping]]
- [[Value 4 Value]]
- [[RSS]] — and the [[Enclosure]] that makes a feed a podcast

## Feed features

- [[Transcripts]]
- [[Chapters]]
- [[Soundbites]]
- [[Cross-app Comments]]

## Paying for it

- [[Splits]] — who gets what, declared in the feed
- [[Streaming Sats]] — paid by the minute
- [[Boost]] — paid on purpose
- [[Boostagram]] — the message that rides along

## Tools and apps

Listening and publishing:

- [[Podverse]] — an app with the namespace features actually implemented
- [[LNBeats]] — value-enabled music, paid per listen
- [[Sovereign Feeds]] — publish a feed carrying tags your host does not support
- [[Demu Feed Template]] — the same job, as a file you edit by hand
- [[Castr.me]] — a Nostr identity turned into a feed

Boosts, end to end:

- [[Helipad]] — read the boosts arriving at your node
- [[BoostCLI]] — send and inspect them from a terminal
- [[Split Box]] — forward a received boost on to the [[Splits|splits]] in the feed
- [[BoostBox]] and [[MetaBoost]] — store the metadata a payment cannot carry itself
- [[extractlv]] — the early proof the TLV data was there to be read
- [[OnlyBoosts]] — boosts published to Nostr, collected in one place
- [[Local Bitcoiners]] — a show publishing its own boost activity

Infrastructure and reference:

- [[Podping Gossipwriter]] — [[Podping]] over a gossip swarm instead of a blockchain
- [[Podcast Platform Links]] — how to link to an episode on a given platform

## Open threads

- Which namespace tags actually see app adoption vs. which stay theoretical
- [[Chapters]] and [[Transcripts|transcripts]]: where the spec is ahead of the tooling
