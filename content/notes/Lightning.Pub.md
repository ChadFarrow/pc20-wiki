---
type: tool
status: seed
tags: [lightning, nostr, infra]
related: ["[[Lightning Network]]", "[[Nostr]]", "[[NIP]]", "[[LNURL]]", "[[Lightning Address]]", "[[Custody]]"]
---

# Lightning.Pub

Lightning.Pub is a Nostr-native account layer on top of a Lightning node, letting one operator share that node with other people's Nostr identities.

## Why it matters

Running a node for friends and family founders on web infrastructure rather than on Bitcoin: static IPs, DNS, reverse proxies, firewalls and TLS certificates all have to be configured before anyone else can reach it. [[Tor]] is the usual escape hatch and is slow. Mobile nodes avoid the problem by not being always-online, which makes them useless for merchants and routing.

## How it works

It exposes a full RPC over ordinary Nostr relays instead of over a server the operator has to expose — see [[Relay]] and [[Reverse Proxy]] — with the transport encrypted per the NIP-44 spec, so accounts are addressed by Nostr identity. Optional services keep backward compatibility with [[LNURL]] and [[Lightning Address]].

## Open questions

- Sharing your node with others' accounts is a [[Custody]] arrangement, whatever the transport
