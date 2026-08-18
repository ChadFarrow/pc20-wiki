---
type: tool
status: seed
tags: [podcasting]
related: ["[[Podcasting 2.0]]", "[[Podping]]", "[[RSS]]"]
---

# Podcast Index

Podcast Index is an open, freely queryable directory of podcast feeds, built so that no single company controls the canonical list of what podcasts exist.

## Why it matters

Search and discovery were the last real chokepoint in open podcasting: distribution was decentralized, but finding a show meant going through someone's directory. An open index removes that dependency and gives new apps a place to start.

It is also the practical substrate for [[Podcasting 2.0]]. An app that wants to know which feeds carry a namespace tag, or which music feeds exist, asks the index — which is why so many tools in this space begin with an API key rather than a crawler.

## How it works

Feeds are submitted or crawled, assigned a stable numeric feed ID, and exposed through a public HTTP API that any developer can query. Feeds that declare a `<podcast:guid>` are tracked by that instead, so a show keeps one identity even when its URL moves.

Authentication is three headers rather than a token. `X-Auth-Key` carries the API key, `X-Auth-Date` carries the current unix time as a string, and `Authorization` carries the lowercase hex SHA-1 of the key, the secret and that timestamp concatenated. The timestamp has a three minute window, so a request cannot be replayed later.

[[Podping]] feeds the index near-real-time notice of updates, which is what keeps it current without polling every feed on a timer.

## Open questions

- Handling duplicates, dead feeds, and hostile submissions at scale

## Sources

- https://podcastindex-org.github.io/docs-api/
