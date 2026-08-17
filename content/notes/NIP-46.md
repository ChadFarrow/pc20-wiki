---
type: spec
status: seed
tags: [nostr, keys]
related: ["[[Nostr]]", "[[NIP]]"]
---

# NIP-46

NIP-46 defines remote signing: an app requests a signature from a separate signer holding the private key, so the key never enters the app itself.

## Why it matters

Pasting a private key into every client is the worst habit in Nostr and the fastest route to permanent loss. Remote signing gives users one place where the key lives and revocable connections everywhere else.

## How it works

The client and signer establish a connection, often initiated by a URI or QR code. When the client needs an event signed, it sends a signing request over relays; the signer approves and returns the signature. The signer may be a mobile app, a browser extension, or a hosted bunker.

## Open questions

- Reconnection behavior is fragile in practice, especially on mobile where apps get suspended
