---
type: tool
status: seed
tags: [infra, bitcoin]
related: ["[[Self-hosting]]", "[[LND]]"]
---

# StartOS

StartOS is an operating system for personal servers that packages self-hosted services into installable apps with managed dependencies, networking, and backups.

## Why it matters

It compresses most of the operational burden of [[Self-hosting]] into a UI. Running a Bitcoin node with [[LND]] and [[LNbits]] on top becomes installation rather than integration work.

## How it works

Services ship as packaged apps declaring their dependencies. The system handles service-to-service wiring, TLS, Tor and LAN addressing, and backup scheduling.

## Open questions

- Packaged convenience versus configuration reach when a service needs unusual settings
