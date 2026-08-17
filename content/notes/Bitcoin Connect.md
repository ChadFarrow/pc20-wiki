---
type: tool
status: seed
tags: [lightning, dev]
related: ["[[Lightning Network]]", "[[Lightning Invoice]]", "[[Value 4 Value]]"]
---

# Bitcoin Connect

Bitcoin Connect is a set of web components that let a website offer Lightning wallet connection and invoice payment without the visitor installing a browser extension.

## Why it matters

WebLN gave web apps one interface to a Lightning wallet, but getting it required an extension, which meant desktop-only and a install-first funnel. Moving the connection UI into the site itself makes [[Value 4 Value]] payments reachable from any browser, mobile included.

## How it works

The site embeds the components, which handle connecting to a wallet and enabling WebLN in the page, including over Nostr Wallet Connect. The site then talks only to WebLN and stays indifferent to which wallet answered. There is also a drop-in payment UI that presents a [[Lightning Invoice]] with several ways to pay it. The components are framework-agnostic, with a React package alongside.

## Open questions

- The project describes itself as alpha and depends on protocols still in flux
