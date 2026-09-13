/**
 * The worker's first import. It delegates to the one polyfill module the popup
 * and the approval window also import, so all three browser entries share a
 * single definition and land in the same `polyfill-buffer` chunk — which is
 * what makes the ordering hold. A chunk is evaluated before the chunk that
 * imports it, while code inlined into an entry chunk's own body runs *after*
 * every chunk that entry imports, and `@solana/spl-token-metadata` calls
 * `Buffer.from` while it evaluates.
 */
import '../lib/buffer-global';
