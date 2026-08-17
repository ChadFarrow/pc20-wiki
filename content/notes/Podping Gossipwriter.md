---
type: tool
status: seed
tags: [podcasting, infra]
related: ["[[Podping]]", "[[RSS]]", "[[Podcast Index]]"]
---

# Podping Gossipwriter

Podping Gossipwriter is the module that broadcasts Podping notifications over a peer-to-peer gossip swarm instead of a blockchain.

## Why it matters

[[Podping]] works by writing feed-update notifications to a shared medium anyone can watch, and in practice that medium has been the Hive blockchain. Hive is a dependency and a single kind of failure. A gossip swarm gives the same notifications a second, structurally different path to consumers.

## How it works

It receives Cap'n Proto `PodpingWrite` messages from the podping.cloud front end over a ZeroMQ socket, signs each notification with an ed25519 key, archives it to SQLite, and broadcasts it to an iroh-gossip swarm on a shared topic. It runs alongside the Hive writer rather than replacing it — podping.cloud dual-writes, and the front end treats this path as fire-and-forget, so Hive writes are unaffected if it is down.

## Open questions

- Signed notifications imply a key to trust; how do consumers learn which keys are legitimate

## Sources

- https://podcasting2.org/docs/podcast-namespace/tags/podping
