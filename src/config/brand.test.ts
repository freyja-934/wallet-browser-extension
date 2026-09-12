import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CINDER_ICON_DATA_URI, CINDER_MARK_SVG } from './brand';

describe('Cinder brand mark', () => {
  it('is a base64 SVG data URI that decodes to the mark', () => {
    const prefix = 'data:image/svg+xml;base64,';
    expect(CINDER_ICON_DATA_URI.startsWith(prefix)).toBe(true);
    const decoded = atob(CINDER_ICON_DATA_URI.slice(prefix.length));
    expect(decoded).toBe(CINDER_MARK_SVG);
  });

  it('is a well-formed 32×32 SVG document', () => {
    const svg = CINDER_MARK_SVG;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 32 32"');
    // Every opening tag is either self-closing or closed again; no stray `<`.
    const opens = (svg.match(/<([a-zA-Z]+)[^>]*?(?<!\/)>/g) ?? []).map((tag) => tag.match(/^<([a-zA-Z]+)/)![1]);
    const closes = (svg.match(/<\/([a-zA-Z]+)>/g) ?? []).map((tag) => tag.slice(2, -1));
    expect(opens.sort()).toEqual(closes.sort());
    expect(svg).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+);)/);
  });

  it('uses only valid 3- or 6-digit hex colours', () => {
    const colours = CINDER_MARK_SVG.match(/#[^"\s;)]+/g) ?? [];
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) {
      if (colour.startsWith('#cinder-')) continue; // url(#id) references, not colours
      expect(colour).toMatch(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    }
  });

  it('does not import React or touch the DOM (the injected bundle is a bare IIFE)', () => {
    const source = readFileSync(new URL('./brand.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]react/);
    expect(source).not.toMatch(/\bdocument\b|\bwindow\b/);
  });

  it('is what the injected wallet registers', () => {
    const injected = readFileSync(new URL('../content/injected.ts', import.meta.url), 'utf8');
    expect(injected).toContain('icon: CINDER_ICON_DATA_URI');
    expect(injected).toContain("version: '1.0.0'");
    expect(injected).not.toContain('data:image/svg+xml;base64,');
  });
});
