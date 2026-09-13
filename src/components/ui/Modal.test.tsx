// @vitest-environment jsdom
/**
 * The keyboard contract the Playwright suite can only partly reach: it drives
 * one sheet at a time in a real popup, so the stacked case — a dialog opened
 * over a sheet that is still open — has no e2e. This is the cheaper guard.
 *
 * jsdom has no layout, so `getClientRects()` is empty and `offsetParent` is
 * null for everything, which would make `Modal`'s own `isRendered` call every
 * control invisible. The rect stub below is what a browser would report; it is
 * the only thing faked here, and the focus logic under test is untouched.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal, ModalContent } from './Modal';

function stubLayout(): void {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 100, 20)] as unknown as DOMRectList,
  );
}

/** Press a key on whatever has focus; `Modal` listens on the document, so it bubbles there. */
function press(key: string, options: { shift?: boolean } = {}): void {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, shiftKey: options.shift === true });
}

function Sheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal isOpen onClose={onClose} aria-label="Sheet">
      <ModalContent>
        <button type="button">First</button>
        <button type="button">Middle</button>
        <button type="button">Last</button>
      </ModalContent>
    </Modal>
  );
}

/** An opener button and the sheet it opens — the shape every popup screen uses. */
function OneSheet() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && <Sheet onClose={() => setOpen(false)} />}
    </>
  );
}

/** A sheet with a control that opens a second sheet over it, as Settings does. */
function StackedSheets({ onCloseOuter, onCloseInner }: { onCloseOuter: () => void; onCloseInner: () => void }) {
  const [inner, setInner] = useState(false);
  return (
    <Modal isOpen onClose={onCloseOuter} aria-label="Outer">
      <ModalContent>
        <button type="button">Outer first</button>
        <button type="button" onClick={() => setInner(true)}>
          Open inner
        </button>
        {inner && (
          <Modal isOpen onClose={onCloseInner} aria-label="Inner">
            <ModalContent>
              <button type="button">Inner first</button>
              <button type="button">Inner last</button>
            </ModalContent>
          </Modal>
        )}
      </ModalContent>
    </Modal>
  );
}

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(stubLayout);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Modal focus', () => {
  it('focuses the first control in the sheet when it opens', () => {
    render(<OneSheet />);

    fireEvent.click(button('Open'));

    expect(document.activeElement).toBe(button('First'));
  });

  it('hands focus back to the control that opened it', () => {
    render(<OneSheet />);
    const opener = button('Open');
    opener.focus();

    fireEvent.click(opener);
    expect(document.activeElement).toBe(button('First'));

    press('Escape');

    expect(document.activeElement).toBe(opener);
  });

  it('wraps Tab from the last control back to the first', () => {
    render(<OneSheet />);
    fireEvent.click(button('Open'));
    button('Last').focus();

    press('Tab');

    expect(document.activeElement).toBe(button('First'));
  });

  it('wraps Shift+Tab from the first control back to the last', () => {
    render(<OneSheet />);
    fireEvent.click(button('Open'));
    button('First').focus();

    press('Tab', { shift: true });

    expect(document.activeElement).toBe(button('Last'));
  });

  it('gives the keyboard to a second sheet stacked over the first', () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    render(<StackedSheets onCloseOuter={onCloseOuter} onCloseInner={onCloseInner} />);

    fireEvent.click(button('Open inner'));
    expect(document.activeElement).toBe(button('Inner first'));

    // Tab wraps inside the sheet on top, not out into the one underneath.
    button('Inner last').focus();
    press('Tab');
    expect(document.activeElement).toBe(button('Inner first'));

    // And Escape closes the sheet on top alone.
    press('Escape');
    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
  });
});
