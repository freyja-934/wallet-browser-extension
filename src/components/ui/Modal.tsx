import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/** What the browser will put focus on, in document order. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

export function Modal({ isOpen, onClose, children, className = '' }: ModalProps) {
  const sheet = useRef<HTMLDivElement>(null);
  /** Whatever had focus when the sheet opened; focus goes back there when it closes. */
  const opener = useRef<HTMLElement | null>(null);

  // Focus the sheet's first control on open, and hand focus back to the control
  // that opened it on close — otherwise focus falls to the document body and a
  // keyboard user has to tab from the top of the popup again.
  useEffect(() => {
    if (!isOpen) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusableIn(sheet.current)[0]?.focus();
    return () => {
      opener.current?.focus();
      opener.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
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
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2 }}
            className={`glass-panel relative z-10 w-full max-h-[90%] overflow-y-auto rounded-t-3xl rounded-b-none border-b-0 shadow-card ${className}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" />
            {children}
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
  return (
    <div className={`flex items-center justify-between px-5 pt-4 pb-3 ${className}`}>
      <h2 className="text-lg font-semibold tracking-tight text-fg-0">{children}</h2>
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
