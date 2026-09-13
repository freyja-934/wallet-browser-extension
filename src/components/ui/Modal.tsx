import { AnimatePresence, motion } from 'framer-motion';
import { createContext, useContext, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { Icon } from './Icon';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /**
   * Changing this re-runs the initial focus. A sheet that swaps its contents
   * while it stays open — Send's amount step for its review, Settings' password
   * prompt for the revealed phrase — unmounts the control that had focus, and
   * focus would otherwise fall to the document body.
   */
  focusKey?: string | number;
  /** Names a sheet rendered without a `ModalHeader`; one with a header is named by its heading. */
  'aria-label'?: string;
}

/** What the browser will put focus on, in document order. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable]:not([contenteditable="false"])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Rendered, so the browser will actually focus it. `offsetParent` is null for a
 * `display: none` element and for a `position: fixed` one, hence the second
 * look: a fixed element still has client rects. This is what a `hidden`
 * attribute, a collapsed `<details>`, or a parent with `display: none` fail.
 */
function isRendered(element: HTMLElement): boolean {
  return element.offsetParent !== null || element.getClientRects().length > 0;
}

function focusableIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => isRendered(element) && element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Focus the first control that will take it. A candidate can still refuse —
 * `visibility: hidden`, `inert`, a control mid-transition — and a refused
 * `focus()` leaves the document body focused, so walk on to the next one.
 */
function focusFirstIn(root: HTMLElement | null): boolean {
  for (const candidate of focusableIn(root)) {
    candidate.focus();
    if (document.activeElement === candidate) return true;
  }
  return false;
}

/**
 * Every open sheet, outermost first. Sheets do stack — Settings opens a confirm
 * dialog over the sheet already showing the phrase — and each one installs its
 * own document keydown listener, so without this the traps fight: Tab is
 * pulled back by the sheet underneath and Escape closes the wrong one.
 */
const sheetStack: RefObject<HTMLDivElement>[] = [];

function isTopSheet(sheet: RefObject<HTMLDivElement>): boolean {
  return sheetStack[sheetStack.length - 1] === sheet;
}

/** The heading id a `ModalHeader` puts on its `h2`, so the dialog can point `aria-labelledby` at it. */
const ModalTitleId = createContext<string | undefined>(undefined);

export function Modal({
  isOpen,
  onClose,
  children,
  className = '',
  focusKey,
  'aria-label': ariaLabel,
}: ModalProps) {
  const sheet = useRef<HTMLDivElement>(null);
  /** Whatever had focus when the sheet opened; focus goes back there when it closes. */
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // On the stack first, off it first: the effects below, and the ones the
  // sheet above this one runs, read the stack to decide who owns the keyboard.
  useEffect(() => {
    if (!isOpen) return;
    sheetStack.push(sheet);
    return () => {
      const at = sheetStack.lastIndexOf(sheet);
      if (at !== -1) sheetStack.splice(at, 1);
    };
  }, [isOpen]);

  // Hand focus back to the control that opened the sheet — otherwise focus
  // falls to the document body and a keyboard user has to tab from the top of
  // the popup again. That control can be gone (a step change, or a sheet that
  // closed the screen behind it), so an unmounted opener falls back to the
  // sheet still underneath this one, and only then to the page.
  useEffect(() => {
    if (!isOpen) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const target = opener.current;
      opener.current = null;
      if (target?.isConnected) {
        target.focus();
        return;
      }
      const below = sheetStack[sheetStack.length - 1];
      focusFirstIn(below?.current ?? document.body);
    };
  }, [isOpen]);

  // The sheet's first control takes focus on open, and again whenever the sheet
  // replaces its contents while staying open.
  useEffect(() => {
    if (!isOpen) return;
    focusFirstIn(sheet.current);
  }, [isOpen, focusKey]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      // Only the sheet on top answers the keyboard; the ones under it are inert
      // until it closes, which is what "modal" means to a keyboard user too.
      if (!isTopSheet(sheet)) return;
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      // Tab stays inside the sheet: a modal that lets focus walk out onto the
      // screen behind it is a modal only to the mouse.
      if (event.key !== 'Tab') return;
      const items = focusableIn(sheet.current);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof Node && sheet.current?.contains(active);
      if (event.shiftKey ? active === first || !inside : active === last || !inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.button
            type="button"
            aria-label="Dismiss"
            className="absolute inset-0 bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={sheet}
            role="dialog"
            aria-modal="true"
            // Named by its own heading unless it has no header to carry one.
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : titleId}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2 }}
            className={`glass-panel relative z-10 w-full max-h-[90%] overflow-y-auto rounded-t-3xl rounded-b-none border-b-0 shadow-card ${className}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" />
            <ModalTitleId.Provider value={titleId}>{children}</ModalTitleId.Provider>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function ModalHeader({
  children,
  onClose,
  className = '',
}: {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  // The dialog points `aria-labelledby` here, so the sheet is announced by its title.
  const titleId = useContext(ModalTitleId);
  return (
    <div className={`flex items-center justify-between px-5 pt-4 pb-3 ${className}`}>
      <h2 id={titleId} className="text-lg font-semibold tracking-tight text-fg-0">
        {children}
      </h2>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Close"
          className="grid h-8 w-8 place-items-center rounded-full text-fg-2 hover:bg-white/10 hover:text-fg-0"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function ModalContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 py-3 ${className}`}>{children}</div>;
}

export function ModalFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 pb-5 pt-3 ${className}`}>{children}</div>;
}
