---
type: spec
status: seed
tags: [nostr, spec]
related: ["[[Nostr]]", "[[Relay]]"]
---

# NIP

A NIP — Nostr Implementation Possibility — is a numbered document describing a piece of the Nostr protocol or an optional extension to it.

## Why it matters

Nostr has no central authority, so NIPs are how anything becomes shared behavior. A NIP is only real to the degree clients and relays implement it, which makes adoption, not approval, the measure of a spec.

The repository says as much itself: the list is not a protocol checklist, nothing forces any software to implement any NIP, and each app picks the subset relevant to it. Proposals also circulate outside the repository as pull requests, and some are deployed in the wild before they are merged.

## How it works

Proposals are opened in a public repository, discussed, and assigned numbers. NIP-01 is the base: the event object, the signature scheme, and the client–relay messages. Everything else is optional on top of it.

The numbers are the working vocabulary. NIP-05 maps a key to a DNS-based identifier. NIP-07 defines `window.nostr`, the browser capability that lets a web client sign without holding the key itself. NIP-11 is the relay information document. NIP-19 defines the bech32 entities a user actually sees — `npub`, `nsec`, `note`. NIP-44 is the current versioned encryption scheme. NIP-57 defines Lightning zaps, which is where Nostr meets [[Value 4 Value]]. NIP-65 tells a client which relays an author reads and writes.

## Related

- [[NIP-46]] — remote signing

## Sources

- https://github.com/nostr-protocol/nips
- https://github.com/nostr-protocol/nips/blob/master/01.md
