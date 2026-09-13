import { accountAt } from '../../lib/messages';
import { hideReceive } from '../../store/slices/uiSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { Modal, ModalContent, ModalHeader } from '../ui/Modal';
import { ReceiveCard } from './ReceiveCard';

export function ReceiveModal() {
  const dispatch = useAppDispatch();
  const { showReceiveModal } = useAppSelector((state) => state.ui);
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const activeAccount = accountAt(accounts, activeAccountIndex);

  if (!activeAccount) return null;

  return (
    <Modal isOpen={showReceiveModal} onClose={() => dispatch(hideReceive())}>
      <ModalHeader onClose={() => dispatch(hideReceive())}>Receive</ModalHeader>
      <ModalContent>
        <ReceiveCard address={activeAccount.address} />
      </ModalContent>
    </Modal>
  );
}
