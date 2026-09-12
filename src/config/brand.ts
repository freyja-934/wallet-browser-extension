/**
 * Cinder Wallet mark for surfaces that cannot use React or CSS: the Wallet
 * Standard `icon`, which dApps render from a base64 data URI.
 *
 * Keep this file free of React and DOM imports; the injected bundle is a plain
 * IIFE with no JSX runtime. Every colour is a 6-digit hex so any SVG parser
 * accepts it (the previous icon carried an invalid `#9945VF`).
 */

const BRAND_INK = '#010000';
const BRAND_GLOW = '#ff7b16';
const BRAND_EMBER = '#d1671f';

/** 32×32 rounded square with the orange glow ring from the popup's GlowMark. */
export const CINDER_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">' +
  '<defs>' +
  `<linearGradient id="cinder-glow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND_GLOW}"/><stop offset="1" stop-color="${BRAND_EMBER}"/></linearGradient>` +
  '</defs>' +
  `<rect width="32" height="32" rx="10" fill="${BRAND_INK}"/>` +
  '<rect x="6" y="6" width="20" height="20" rx="6" fill="none" stroke="url(#cinder-glow)" stroke-width="2.5"/>' +
  '<rect x="11" y="11" width="10" height="10" rx="3" fill="url(#cinder-glow)" opacity="0.55"/>' +
  '</svg>';

/** Base64 data URI of {@link CINDER_MARK_SVG}, shaped to satisfy `@wallet-standard/base`'s `WalletIcon`. */
export const CINDER_ICON_DATA_URI: `data:image/svg+xml;base64,${string}` =
  `data:image/svg+xml;base64,${btoa(CINDER_MARK_SVG)}`;
