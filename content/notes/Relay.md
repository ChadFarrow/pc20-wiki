---
type: concept
status: seed
tags: [nostr]
related: ["[[Nostr]]", "[[Nostr Event]]", "[[NIP]]"]
---

# Relay

A relay is a server that accepts signed [[Nostr Event|Nostr events]], stores them, and serves them to clients that subscribe with filters.

## Why it matters

Relays are where decentralization actually lives or dies. Because clients read from many at once, no single relay is load-bearing — but if everyone converges on the same three, the property is theoretical.

A relay is also deliberately unintelligent. It does not resolve identity, thread conversations, or decide what a client should see. That work belongs to the client, which is why a relay can be a few hundred lines and why running one is within reach of an individual.

## How it works

Clients connect over WebSocket and exchange JSON arrays. A client sends `EVENT` to publish, `REQ` with a subscription id and filters to ask for events, and `CLOSE` to end a subscription. The relay answers with `EVENT` for each match, `EOSE` when the stored events run out and the live feed begins, `OK` to accept or reject a publish, `CLOSED` when it ends a subscription itself, and `NOTICE` for human-readable messages.

A filter selects on `ids`, `authors`, `kinds`, single-letter tag fields such as `#e` and `#p`, and the `since`, `until` and `limit` bounds. Relays set their own policies — open, paid, whitelisted or topic-scoped — and describe themselves in the relay information document defined by NIP-11.

## Open questions

- Spam economics: free and open are hard to hold simultaneously

## Sources

- https://github.com/nostr-protocol/nips/blob/master/01.md
- https://github.com/nostr-protocol/nips/blob/master/11.md
