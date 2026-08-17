---
type: spec
status: seed
tags: [nostr, spec]
related: ["[[Nostr]]", "[[Relay]]", "[[NIP]]"]
---

# Nostr Event

An event is the only object in [[Nostr]]: a signed JSON blob with a kind number, some tags, and content, which relays store and forward without interpreting.

## Why it matters

Everything is an event. A profile, a note, a reaction, a long-form article, a podcast comment thread — all the same structure with a different `kind`. That uniformity is why a [[Relay]] can be dumb: it never has to know what it is storing.

For podcasting it means a comment thread named by `<podcast:socialInteract>` is just an event, which any client can fetch and reply to — see [[Cross-app Comments]].

## How it works

An event carries `pubkey`, `created_at`, `kind`, `tags`, `content`, and `sig`. The `id` is the SHA-256 of the serialised event, and `sig` is a Schnorr signature over that id — so anyone can verify authorship without asking a server whether it is genuine.

`kind` is an integer naming the type: 0 is metadata, 1 a short note, and so on, with ranges reserved for replaceable and ephemeral events. `tags` carry references to other events and pubkeys, which is how threading and mentions work.

## Sources

- NIP-01, the base protocol: https://github.com/nostr-protocol/nips/blob/master/01.md
