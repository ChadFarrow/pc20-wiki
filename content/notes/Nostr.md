---
type: protocol
status: growing
tags: [nostr]
related: ["[[NIP]]", "[[Relay]]"]
---

# Nostr

Nostr is a protocol where identity is a keypair, messages are [[Nostr Event|signed JSON events]], and servers called relays do nothing but store and forward them.

## Why it matters

It removes the account. There is no signup, no platform that can delete you, and no username someone else controls — your identity is a key you hold, portable across every client.

## How it works

A user has a private key and a public key. Everything published is a signed event with a kind number indicating what it is: a note, a profile, a reaction, a long-form post. Clients push events to [[Relay]] servers and read from several at once. Relays are intentionally dumb, and the interesting behavior lives in clients.

Protocol extensions are proposed as [[NIP]] documents.

## Open questions

- Key loss is unrecoverable, which is the central UX problem — see [[NIP-46]]
