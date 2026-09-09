import { DangerButton, PrimaryButton, SecondaryButton } from './Button';
import { Modal, ModalContent, ModalFooter, ModalHeader } from './Modal';

export function ConfirmDialog({
  isOpen,
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalHeader onClose={onClose}>{title}</ModalHeader>
      <ModalContent>
        <p className="text-sm leading-relaxed text-fg-1">{body}</p>
      </ModalContent>
      <ModalFooter>
        <div className="flex gap-3">
          <SecondaryButton onClick={onClose} className="flex-1">
            Cancel
          </SecondaryButton>
          {danger ? (
            <DangerButton onClick={onConfirm} className="flex-1">
              {confirmLabel}
            </DangerButton>
          ) : (
            <PrimaryButton onClick={onConfirm} className="flex-1">
              {confirmLabel}
            </PrimaryButton>
          )}
        </div>
      </ModalFooter>
    </Modal>
  );
}
