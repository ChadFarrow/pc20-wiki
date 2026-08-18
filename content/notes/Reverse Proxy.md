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

It is also the only piece that has to be exposed. Backends can listen on the loopback interface and stay unreachable from the network, which turns "secure every service" into "secure one".

## How it works

The proxy listens on the public ports. For an HTTPS request it reads the server name from the TLS handshake, completes the handshake with the certificate for that name, then reads the `Host` header and the path to choose a backend. It opens a separate connection inward, usually plain HTTP, and copies the response back.

Because the backend now sees a connection from the proxy rather than from the visitor, the original details are passed as headers — `X-Forwarded-For` for the client address and `X-Forwarded-Proto` for the original scheme. An application that logs or rate-limits by IP must be told to trust these, and must trust them only from the proxy, or anyone can forge one.

Certificate renewal usually lives here too, since the proxy already owns port 443 and can answer the challenge.

## Related

- [[Self-hosting]]
