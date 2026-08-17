---
type: concept
status: seed
tags: [nostr]
related: ["[[Nostr]]"]
---

# Relay

A relay is a server that accepts signed Nostr events, stores them, and serves them to clients that subscribe with filters.

## Why it matters

Relays are where decentralization actually lives or dies. Because clients read from many at once, no single relay is load-bearing — but if everyone converges on the same three, the property is theoretical.

## How it works

Clients connect over WebSocket, send subscription filters (by author, kind, tag, time), and receive matching events plus anything new. Relays set their own policies: open, paid, whitelisted, or topic-scoped.

## Open questions

- Spam economics: free and open are hard to hold simultaneously
