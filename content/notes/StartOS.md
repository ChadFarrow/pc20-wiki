---
type: tool
status: seed
tags: [infra, bitcoin]
related: ["[[Self-hosting]]", "[[LND]]", "[[Tor]]"]
---

# StartOS

StartOS is an operating system for personal servers that packages self-hosted services into installable apps with managed dependencies, networking, and backups.

## Why it matters

It compresses most of the operational burden of [[Self-hosting]] into a UI. Running a [[Bitcoin]] node with [[LND]] and [[LNbits]] on top becomes installation rather than integration work.

The harder problem it solves is reachability. A home server has no public address and no certificate authority will issue for it, so most self-hosting guides end at port forwarding. StartOS gives every service a LAN address and a [[Tor]] address at install time, and never asks the operator to open a port.

## How it works

Services ship as S9PK packages — a signed, merkle-archived format that supports partial downloads and cryptographic verification, so a package can be checked before it is trusted. Each service runs in its own isolated container rather than sharing one host environment.

The system handles the parts that are usually manual: discovery on the local network, dependency wiring between services, certificate issuance for the `.local` address, Tor addressing, health monitoring, and scheduled backups to an external target.

Dependencies are declared, not assumed. A package that needs a Bitcoin node names it, and the OS either connects it to the one already installed or tells the operator what is missing — which is the difference between an app store and a folder of compose files.

## Open questions

- Packaged convenience versus configuration reach when a service needs unusual settings

## Sources

- https://docs.start9.com/
- https://github.com/Start9Labs/start-os
