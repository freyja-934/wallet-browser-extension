import { AnimatePresence, motion } from 'framer-motion';
import React from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ isOpen, onClose, children, className = "" }: ModalProps) {
  if (!isOpen) return null;
  
  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18 }}
          className={`bg-bg-1 rounded-xl border border-ui-border shadow-card w-full max-w-md ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export function ModalHeader({ children, onClose, className = "" }: { children: React.ReactNode; onClose?: () => void; className?: string }) {
  return (
    <div className={`px-6 py-4 border-b border-ui-border flex items-center justify-between ${className}`}>
      <h2 className="text-lg font-semibold text-fg-0">{children}</h2>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Close modal"
          className="p-1 hover:bg-bg-2 rounded-md transition-colors duration-fast"
        >
          <svg className="w-5 h-5 text-fg-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ModalContent({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-6 py-4 ${className}`}>
      {children}
    </div>
  );
}

export function ModalFooter({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-6 py-4 border-t border-ui-border ${className}`}>
      {children}
    </div>
  );
}
