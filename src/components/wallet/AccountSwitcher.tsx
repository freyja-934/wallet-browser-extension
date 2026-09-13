import { useState } from 'react';
import toast from 'react-hot-toast';
import { errorMessage } from '../../lib/errors';
import { accountAt, MAX_ACCOUNT_NAME_LENGTH } from '../../lib/messages';
import { extensionClient } from '../../messaging/client';
import { initializeWallet } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { Icon } from '../ui/Icon';

function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * The header account list: switch, add, rename. Accounts and the active index
 * are public state, so they come from Redux; every change goes to the worker
 * and the popup then re-reads what the worker says, rather than guessing.
 */
export function AccountSwitcher() {
  const dispatch = useAppDispatch();
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // By the account's own index, not its position in the list.
  const active = accountAt(accounts, activeAccountIndex);

  if (!active) return null;

  const run = async (action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    // Say so rather than swallowing the click: an unexplained no-op reads as a broken button.
    if (busy) {
      toast.error('One change at a time — still finishing the last one');
      return false;
    }
    setBusy(true);
    try {
      await action();
      await dispatch(initializeWallet()).unwrap();
      return true;
    } catch (error) {
      toast.error(errorMessage(error, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cancelRename = () => {
    setRenaming(null);
    setDraft('');
  };

  const close = () => {
    setOpen(false);
    cancelRename();
  };

  const handleSwitch = async (index: number) => {
    if (index === activeAccountIndex) {
      close();
      return;
    }
    if (await run(() => extensionClient.switchAccount(index), 'Could not switch account')) close();
  };

  const handleAdd = async () => {
    if (await run(() => extensionClient.addAccount(), 'Could not add an account')) {
      toast.success('Account added');
    }
  };

  /** Enter commits. An empty draft is not a rename: leave edit mode rather than trapping the user in it. */
  const handleRename = async (index: number) => {
    const name = draft.trim();
    if (!name) {
      cancelRename();
      return;
    }
    if (await run(() => extensionClient.renameAccount(index, name), 'Could not rename that account')) {
      cancelRename();
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="account-switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="relative z-40 flex items-center gap-1 text-sm font-semibold tracking-tight hover:text-brand-a"
      >
        <span className="max-w-[10rem] truncate">{active.name}</span>
        <Icon name="chevron" className={`h-3 w-3 transition ${open ? '-rotate-90' : 'rotate-90'}`} />
      </button>

      {open && (
        <>
          {/* Click anywhere else to dismiss; the panel sits above it. */}
          <button
            type="button"
            aria-label="Close account list"
            onClick={close}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            role="menu"
            className="absolute left-0 top-full z-40 mt-2 w-[17rem] rounded-2xl border border-white/10 bg-bg-1 p-1.5 shadow-card"
          >
            {accounts.map((account) => (
              <div key={account.index} className="flex items-center gap-1">
                {renaming === account.index ? (
                  <input
                    autoFocus
                    value={draft}
                    maxLength={MAX_ACCOUNT_NAME_LENGTH}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRename(account.index);
                      if (e.key === 'Escape') cancelRename();
                    }}
                    // Clicking away abandons the edit; only Enter commits it, so
                    // a half-typed name never becomes the account's name by accident.
                    onBlur={cancelRename}
                    data-testid="account-rename-input"
                    className="h-9 flex-1 rounded-xl border border-white/15 bg-black/40 px-2 text-xs text-fg-0 focus:outline-none focus:shadow-focus"
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="account-option"
                      aria-current={account.index === activeAccountIndex}
                      disabled={busy}
                      onClick={() => void handleSwitch(account.index)}
                      className={`flex min-w-0 flex-1 items-center justify-between rounded-xl px-2.5 py-2 text-left hover:bg-white/5 ${
                        account.index === activeAccountIndex ? 'bg-white/5' : ''
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-fg-0">{account.name}</span>
                        <span className="block font-mono text-[10px] text-fg-3">{short(account.address)}</span>
                      </span>
                      {account.index === activeAccountIndex && (
                        <Icon name="check" className="ml-2 h-3.5 w-3.5 shrink-0 text-brand-a" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename ${account.name}`}
                      data-testid="account-rename"
                      disabled={busy}
                      onClick={() => {
                        setDraft(account.name);
                        setRenaming(account.index);
                      }}
                      className="rounded-xl px-2 py-2 text-[10px] uppercase tracking-[0.12em] text-fg-3 hover:text-fg-0"
                    >
                      Rename
                    </button>
                  </>
                )}
              </div>
            ))}

            <button
              type="button"
              data-testid="account-add"
              disabled={busy}
              onClick={() => void handleAdd()}
              className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-white/8 px-2.5 py-2 text-xs text-fg-1 hover:bg-white/5 disabled:opacity-40"
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              Add account
            </button>
          </div>
        </>
      )}
    </div>
  );
}
