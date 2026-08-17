---
type: tool
status: seed
tags: [bitcoin, lightning, infra]
related: ["[[Bitcoin]]", "[[Lightning Network]]", "[[LND]]", "[[Self-hosting]]", "[[Custody]]"]
---

# RaspiBlitz

RaspiBlitz is a do-it-yourself Bitcoin and Lightning full node built on a Raspberry Pi, with an optional LCD for setup and monitoring.

## Why it matters

Running your own node is the difference between using [[Bitcoin]] and trusting someone who does — the [[Custody]] question in hardware form. RaspiBlitz is aimed as much at learning as at operating: the point is to end up understanding the stack you are running, not just to own an appliance.

## How it works

An SD card image turns a Raspberry Pi 4 or 5 into a full node running Bitcoin Core and a Lightning implementation such as [[LND]], administered from a menu on the attached display, over SSH, or through a web UI. See [[Self-hosting]] for the broader pattern.

## Open questions

- Initial block download and disk wear are the practical limits of Pi-class hardware
