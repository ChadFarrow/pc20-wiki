---
type: concept
status: seed
tags: [infra]
related: ["[[StartOS]]", "[[Reverse Proxy]]", "[[Tor]]"]
---

# Self-hosting

Self-hosting is running services on hardware you control rather than renting the same functionality from a provider.

## Why it matters

It changes who holds the keys, the data, and the ability to shut you off. The honest cost is that you become the operations team — upgrades, backups, uptime, and security are now yours.

The bill also arrives unevenly. Installation is an afternoon; the real work is the second year, when a dependency changes, a disk fills, or a certificate expires while you are away.

## How it works

A machine runs services, usually in containers, behind a [[Reverse Proxy]] that terminates TLS and routes by hostname. Certificates come from an automated authority, which the proxy renews without being asked.

Reaching those services from outside is the decision that shapes everything else. Port forwarding is the direct route and exposes the machine to the whole internet. A VPN or an overlay network keeps everything private but means every device must join it first. A tunnel lets an outbound connection from your box do the work, so nothing has to be opened at the router. [[Tor]] is the fourth option, and needs no public address at all.

Backups are the part most often deferred. A service that holds keys or channel state is not restorable from a fresh install — see [[LND]], where the seed phrase alone is not enough.

## Open questions

- Which services are worth the operational burden and which are self-hosted out of principle alone
