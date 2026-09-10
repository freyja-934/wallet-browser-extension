# ADR 0001 — Lumen Wave design system

The product shipped as **Cinder Wallet**. “Lumen Wave” is the name of this visual decision, not the brand.

## Context

The popup mixed a Solana-gradient dark theme with leftover light/indigo onboarding. The wallet needs one visual language that fits a 380×600 Chrome extension and matches the orange–purple flowing-light references.

## Options considered

1. Quiet champagne “aperture” luxury (no motion background).
2. **Futuristic dark + burnt orange glow**, with the orange–purple wave as atmosphere (chosen).
3. Keep Solana purple–green merch colors.

## Decision

Ship a **Lumen Wave** system:

- Surfaces: `#010000`, `#171413`, `#483c35`
- Ink: `#ebeae9`, `#959190`
- Action/glow: `#d1671f`, `#ff7b16`, `#ed690b`, `#773506`
- Type: self-hosted Sora (UI) + IBM Plex Mono (addresses)
- Home (tokens) loops `public/media/bg-video.mp4` (H.264 from the 0909 wave, muted). Unlock, welcome, loading, NFTs, activity, settings, and approval use the static `bg-img.jpg` (soft purple–orange wash). GIF is not used — it bands the fiber lines. HEVC source is re-encoded because Chrome `<video>` does not reliably play HEVC. `prefers-reduced-motion` also uses the still.
- Popup is pinned to 380×600 (`html`/`body`/`#root` and `.popup-container`). Chrome action popups max out at 600px tall — 640 forced a page scrollbar that clipped the bottom nav and CTAs. Do not use `100vh` — Chrome treats that as the browser window.
- `.glow-square` uses the specified inset orange glow (scaled; 340px is the authored size)
- Bottom navigation; settings from the header; sheets instead of centered modals
- No new UI kit dependency. Fonts and media are packaged (extension CSP forbids font CDNs)

The source `.mov` is 4K ProRes (~1.4GB) and is **not** in the repo. Only the compressed MP4 + JPEG ship.

## Consequences

- Unpacked size grows by ~1.3MB (video + still + fonts).
- Video autoplay is muted-only; `prefers-reduced-motion` uses the still.
- Controls that are not wired stay hidden (RPC switch, fee speed, USD amount toggle).
