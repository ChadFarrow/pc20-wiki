---
type: concept
status: seed
tags: [infra]
related: ["[[StartOS]]", "[[Reverse Proxy]]"]
---

# Self-hosting

Self-hosting is running services on hardware you control rather than renting the same functionality from a provider.

## Why it matters

It changes who holds the keys, the data, and the ability to shut you off. The honest cost is that you become the operations team — upgrades, backups, uptime, and security are now yours.

## How it works

A machine runs services, usually containerized, behind a [[Reverse Proxy]] that terminates TLS and routes by hostname. Reaching them from outside means port forwarding, a tunnel, or a VPN.

## Open questions

- Which services are worth the operational burden and which are self-hosted out of principle alone
