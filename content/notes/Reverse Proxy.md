---
type: concept
status: seed
tags: [infra, networking]
related: ["[[Self-hosting]]"]
---

# Reverse Proxy

A reverse proxy sits in front of one or more backend services, receiving requests from outside and forwarding them to the right internal destination.

## Why it matters

It is what lets many services share one public IP and one set of certificates, and it is the natural place to put TLS, redirects, and access rules.

## How it works

The proxy listens on the public ports, inspects the requested hostname or path, and forwards to the matching internal address. It terminates TLS, so backends can speak plain HTTP internally.

## Related

- [[Self-hosting]]
