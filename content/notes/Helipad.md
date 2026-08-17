---
type: tool
status: seed
tags: [podcasting, lightning, infra]
related: ["[[Boost]]", "[[Boostagram]]", "[[LND]]", "[[Keysend]]"]
---

# Helipad

Helipad is a self-hosted web app that polls a Lightning node for incoming Podcasting 2.0 payments and shows the boosts and boostagrams attached to them.

## Why it matters

A [[Boost]] arrives at a podcaster's node as a Lightning payment with metadata riding along in the [[Keysend]] TLV records. The node itself has no opinion about any of that — it sees an invoice, not a message. Without something to read the TLVs, the [[Boostagram]] a listener wrote is technically received and practically invisible.

## How it works

A poller thread checks an [[LND]] node for invoices every nine seconds, parses the Podcasting 2.0 TLV records out of them, and stores the result in a local SQLite database. A separate web server thread serves that history over HTTP. It connects using the node's `admin.macaroon` and TLS cert — see [[Macaroon]] — and ships as an Umbrel app or a standalone binary.

## Open questions

- Reading boosts requires admin-level node credentials; what would a read-only path look like
