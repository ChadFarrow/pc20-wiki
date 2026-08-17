---
type: protocol
status: seed
tags: [infra, networking]
related: ["[[Self-hosting]]", "[[StartOS]]", "[[Reverse Proxy]]"]
---

# Tor

Tor is an overlay network that routes traffic through layers of relays, and — the part that matters for [[Self-hosting]] — lets a service be reachable at a `.onion` address without a public IP or an open port.

## Why it matters

For a home server this solves the problem that has nothing to do with anonymity: your router. No port forwarding, no dynamic DNS, no static IP, and nothing exposed to the open internet scanning for it. That is why [[StartOS]] gives every service an onion address by default.

For a Lightning node it also means peers can reach you behind a residential connection, which is otherwise a genuine obstacle to accepting channels.

## How it works

Traffic is wrapped in layers of encryption and passed through several relays, none of which knows both ends. A hidden service publishes descriptors to a directory so clients can find it and meet it at a rendezvous point — the connection is established without either side learning the other's address.

The cost is latency. Onion routing is slow enough to be noticeable, which is why most setups pair it with a [[Reverse Proxy]] on a normal domain for anything a browser will use often.

## Open questions

- Onion addresses are unmemorable by design, which pushes people back toward clearnet for convenience
