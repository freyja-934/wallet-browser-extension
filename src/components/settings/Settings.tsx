import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { getCluster, WALLET_NAME, WALLET_VERSION, type Cluster } from '../../config/constants';
import { SETTINGS_QUERY_KEY, syncSettings, useSettings, useUpdateSettings } from '../../hooks/useSettings';
import { useInvalidateWalletData } from '../../hooks/useWalletQueries';
import { errorMessage } from '../../lib/errors';
import { validatePasswordStrength } from '../../lib/vault-crypto';
import { accountAt, DEFAULT_SETTINGS } from '../../lib/messages';
import { originPatternFor, parseHttpsUrl, saveRpcSettings, type RpcProbeResult, type SaveRpcOutcome } from '../../lib/rpc-save';
import { extensionClient } from '../../messaging/client';
import { clearWalletData, initializeWallet } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { Banner } from '../ui/EmptyState';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DangerButton, PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { FieldLabel, PasswordField, Select, TextField } from '../ui/Input';
import { Icon } from '../ui/Icon';
import { Modal, ModalContent, ModalFooter, ModalHeader } from '../ui/Modal';
import { ConnectedSites } from './ConnectedSites';

const PROBE_TIMEOUT_MS = 10_000;

/** Optional host permissions only; removing a required one throws, which is fine to ignore. */
async function dropOriginPermission(pattern: string): Promise<void> {
  try {
    await chrome.permissions.remove({ origins: [pattern] });
  } catch {
    /* required permission or already gone */
  }
}

type RpcEnvelope = { result?: unknown; error?: { code?: unknown } };

/** One parameterless JSON-RPC call from the popup. Any well-formed envelope proves the endpoint answers us. */
async function rpcEnvelope(
  url: string,
  method: string,
): Promise<{ ok: true; json: RpcEnvelope } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'cinder', method }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: 'Could not reach that endpoint (offline, blocked, or no CORS)' };
  }
  if (!response.ok) {
    return { ok: false, error: `Endpoint answered HTTP ${response.status}` };
  }
  try {
    const json = (await response.json()) as RpcEnvelope;
    if (json.result !== undefined || typeof json.error?.code === 'number') return { ok: true, json };
  } catch {
    /* not JSON */
  }
  return { ok: false, error: 'That endpoint did not answer JSON-RPC' };
}

/** `getHealth` proves the endpoint talks to us; `getGenesisHash` says which chain it serves. */
async function probeRpc(url: string): Promise<RpcProbeResult> {
  const health = await rpcEnvelope(url, 'getHealth');
  if (!health.ok) return health;
  const genesis = await rpcEnvelope(url, 'getGenesisHash');
  if (!genesis.ok) return genesis;
  if (typeof genesis.json.result !== 'string') return { ok: false, error: 'That endpoint did not answer getGenesisHash' };
  return { ok: true, genesisHash: genesis.json.result };
}

export function Settings() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  // The worker's settings are the only source; the defaults stand in while the query settles.
  const hideSmallBalances = settings?.hideSmallBalances ?? DEFAULT_SETTINGS.hideSmallBalances;
  const cluster = settings?.cluster ?? getCluster();
  const autoLockMinutes = settings?.autoLockTimeout ?? DEFAULT_SETTINGS.autoLockTimeout;
  const address = accountAt(accounts, activeAccountIndex)?.address;
  const invalidate = useInvalidateWalletData();
  const [showSeedPhrase, setShowSeedPhrase] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmCopySecret, setConfirmCopySecret] = useState<'seed' | 'key' | null>(null);
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [seedPhrase, setSeedPhrase] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [rpcUrlDraft, setRpcUrlDraft] = useState(settings?.rpcUrl ?? '');
  const [heliusKeyDraft, setHeliusKeyDraft] = useState(settings?.heliusApiKey ?? '');
  const [rpcBusy, setRpcBusy] = useState(false);
  const storedRpcUrl = settings?.rpcUrl ?? '';
  const storedHeliusKey = settings?.heliusApiKey ?? '';

  // Drafts follow the stored values (they arrive async and change on Save / Clear / wipe).
  useEffect(() => {
    setRpcUrlDraft(storedRpcUrl);
  }, [storedRpcUrl]);
  useEffect(() => {
    setHeliusKeyDraft(storedHeliusKey);
  }, [storedHeliusKey]);

  const finishRpcSave = async (outcome: Promise<SaveRpcOutcome>) => {
    setRpcBusy(true);
    try {
      const result = await outcome;
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      invalidate(address);
      toast.success('RPC settings saved');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save RPC settings'));
    } finally {
      setRpcBusy(false);
    }
  };

  /**
   * Click handler, not async: `saveRpcSettings` issues `chrome.permissions.request`
   * synchronously, inside the user gesture, before its first `await`.
   */
  const handleRpcSave = () => {
    const outcome = saveRpcSettings(
      { rpcUrl: rpcUrlDraft, heliusApiKey: heliusKeyDraft, cluster, previousRpcUrl: storedRpcUrl || undefined },
      {
        requestOrigin: (pattern) => chrome.permissions.request({ origins: [pattern] }),
        removeOrigin: dropOriginPermission,
        probe: probeRpc,
        persist: (settings) => updateSettings.mutateAsync(settings),
      },
    );
    void finishRpcSave(outcome);
  };

  const handleRpcClear = async () => {
    setRpcBusy(true);
    try {
      const previous = storedRpcUrl;
      await updateSettings.mutateAsync({ rpcUrl: '', heliusApiKey: '' });
      setRpcUrlDraft('');
      setHeliusKeyDraft('');
      const previousUrl = previous ? parseHttpsUrl(previous) : undefined;
      if (previousUrl) await dropOriginPermission(originPatternFor(previousUrl));
      invalidate(address);
      toast.success('RPC settings cleared');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not clear RPC settings'));
    } finally {
      setRpcBusy(false);
    }
  };

  // Straight to the worker: a thunk would leave the password, and then the
  // phrase, sitting in a Redux action.
  const handleExportSeedPhrase = async () => {
    try {
      setSeedPhrase(await extensionClient.exportSeed(password));
      setPassword('');
    } catch (error) {
      // The worker's own words: a vault this build cannot read is not a typo in the password.
      toast.error(errorMessage(error, 'Invalid password'));
      setPassword('');
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    // The same strength rule the worker enforces, checked here so the user is
    // told before the round trip; the worker is still the one that decides.
    const strength = validatePasswordStrength(newPassword);
    if (!strength.isValid) {
      toast.error(strength.feedback[0] ?? 'Choose a stronger password');
      return;
    }
    try {
      await extensionClient.changePassword(currentPassword, newPassword);
      setShowChangePassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed');
    } catch (error) {
      toast.error(errorMessage(error, 'Current password is incorrect'));
    }
  };

  const handleExportPrivateKey = async () => {
    try {
      setPrivateKey(await extensionClient.exportPrivateKey(password, activeAccountIndex));
      setPassword('');
    } catch (error) {
      toast.error(errorMessage(error, 'Invalid password'));
      setPassword('');
    }
  };

  const handleClearData = async () => {
    try {
      await dispatch(clearWalletData()).unwrap();
      // The worker reverted to defaults; drop the staleTime: Infinity cache and re-sync.
      queryClient.removeQueries({ queryKey: SETTINGS_QUERY_KEY });
      await syncSettings(queryClient);
      dispatch(initializeWallet());
      toast.success('Wallet data cleared');
    } catch {
      toast.error('Failed to clear data');
    }
  };

  const handleAutoLockChange = async (minutes: number) => {
    try {
      await updateSettings.mutateAsync({ autoLockTimeout: minutes });
      toast.success('Auto-lock updated');
    } catch {
      toast.error('Could not update auto-lock');
    }
  };

  const handleHideSmall = async (next: boolean) => {
    try {
      await updateSettings.mutateAsync({ hideSmallBalances: next });
    } catch {
      toast.error('Could not update setting');
    }
  };

  const handleClusterChange = async (next: Cluster) => {
    try {
      await updateSettings.mutateAsync({ cluster: next });
      invalidate(address);
      toast.success(next === 'devnet' ? 'Using Solana Devnet' : 'Using Solana Mainnet');
    } catch {
      toast.error('Could not switch network');
    }
  };

  return (
    <div className="space-y-4 px-4 pb-6 pt-4">
      <h2 className="text-lg font-semibold tracking-tight">Settings</h2>

      <Card>
        <CardContent className="space-y-4">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-fg-2">Security</h3>
          <div>
            <FieldLabel>Auto-lock after</FieldLabel>
            <Select
              value={autoLockMinutes}
              onChange={(e) => handleAutoLockChange(Number(e.target.value))}
              data-testid="settings-autolock"
            >
              <option value={5}>5 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={0}>Never</option>
            </Select>
          </div>
          <div>
            <FieldLabel>Network</FieldLabel>
            <Select
              value={cluster}
              onChange={(e) => handleClusterChange(e.target.value as Cluster)}
              data-testid="settings-cluster"
            >
              <option value="devnet">Devnet</option>
              <option value="mainnet-beta">Mainnet</option>
            </Select>
            <p className="mt-1 text-xs text-fg-3">
              Mainnet is for real SOL. Devnet is for testing only.
            </p>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm text-fg-0">
            Hide small balances
            <input
              type="checkbox"
              checked={hideSmallBalances}
              onChange={(e) => handleHideSmall(e.target.checked)}
              className="h-4 w-4 rounded border-white/20"
            />
          </label>
          <SettingRow title="Change password" onClick={() => setShowChangePassword(true)} testId="settings-change-password" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-fg-2">RPC</h3>
          <div>
            <FieldLabel htmlFor="settings-rpc-url">Custom RPC URL</FieldLabel>
            <TextField
              id="settings-rpc-url"
              name="rpcUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              value={rpcUrlDraft}
              onChange={(e) => setRpcUrlDraft(e.target.value)}
              disabled={rpcBusy}
              data-testid="settings-rpc-url"
            />
            <p className="mt-1 text-xs text-fg-3">
              Tried first, before Helius and the public endpoints. https only. Your public addresses and signed
              transactions are sent to this host.
            </p>
          </div>
          <div>
            <FieldLabel htmlFor="settings-helius-key">Helius API key</FieldLabel>
            <PasswordField
              id="settings-helius-key"
              name="heliusApiKey"
              autoComplete="off"
              placeholder="Optional"
              value={heliusKeyDraft}
              onChange={(e) => setHeliusKeyDraft(e.target.value)}
              disabled={rpcBusy}
              data-testid="settings-helius-key"
            />
            <p className="mt-1 text-xs text-fg-3">
              Stored on this device only. Enables token names and NFTs on Mainnet.
            </p>
          </div>
          <div className="flex gap-3">
            <SecondaryButton
              onClick={() => void handleRpcClear()}
              className="flex-1"
              disabled={rpcBusy}
              data-testid="settings-rpc-clear"
            >
              Clear
            </SecondaryButton>
            <PrimaryButton onClick={handleRpcSave} className="flex-1" disabled={rpcBusy} data-testid="settings-rpc-save">
              Save
            </PrimaryButton>
          </div>
        </CardContent>
      </Card>

      <ConnectedSites />

      <Card>
        <CardContent className="space-y-4">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-fg-2">Backup</h3>
          <SettingRow title="Show seed phrase" description="Requires your password" onClick={() => setShowSeedPhrase(true)} testId="settings-show-seed" />
          <SettingRow
            title="Export private key"
            description="The account selected in the header"
            onClick={() => setShowPrivateKey(true)}
            testId="settings-show-key"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 text-xs text-fg-2">
          <h3 className="text-[11px] uppercase tracking-[0.16em]">About</h3>
          <p>{WALLET_NAME} {WALLET_VERSION}</p>
          <p>Solana wallet extension. Do not store funds you cannot afford to lose.</p>
          <div className="flex flex-wrap gap-3 pt-1">
            <a
              className="text-brand-a underline-offset-2 hover:underline"
              href={typeof chrome !== 'undefined' ? chrome.runtime.getURL('legal/privacy.html') : '/legal/privacy.html'}
              target="_blank"
              rel="noreferrer"
            >
              Privacy
            </a>
            <a
              className="text-brand-a underline-offset-2 hover:underline"
              href={typeof chrome !== 'undefined' ? chrome.runtime.getURL('legal/terms.html') : '/legal/terms.html'}
              target="_blank"
              rel="noreferrer"
            >
              Terms
            </a>
            <a
              className="text-brand-a underline-offset-2 hover:underline"
              href="https://github.com/freyja-934/wallet-browser-extension/issues"
              target="_blank"
              rel="noreferrer"
            >
              Support
            </a>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-ui-danger">Danger zone</h3>
          <DangerButton onClick={() => setConfirmWipe(true)} className="w-full">
            Clear all wallet data
          </DangerButton>
        </CardContent>
      </Card>

      {/* The sheet swaps the password prompt for the phrase while it stays open, so
          `focusKey` moves focus onto the revealed step rather than leaving it on an
          unmounted field. */}
      <Modal
        isOpen={showSeedPhrase}
        onClose={() => { setShowSeedPhrase(false); setSeedPhrase(''); setPassword(''); }}
        focusKey={seedPhrase ? 'phrase' : 'password'}
      >
        {!seedPhrase ? (
          <>
            <ModalHeader>Password required</ModalHeader>
            <ModalContent>
              <PasswordField
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                onKeyDown={(e) => e.key === 'Enter' && handleExportSeedPhrase()}
                data-testid="settings-seed-password"
              />
            </ModalContent>
            <ModalFooter>
              <div className="flex gap-3">
                <SecondaryButton onClick={() => { setShowSeedPhrase(false); setPassword(''); }} className="flex-1">Cancel</SecondaryButton>
                <PrimaryButton onClick={handleExportSeedPhrase} className="flex-1" data-testid="settings-seed-submit">Show phrase</PrimaryButton>
              </div>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader>Recovery phrase</ModalHeader>
            <ModalContent className="space-y-4">
              <Banner tone="danger">Never share these words. Anyone with them can move your funds.</Banner>
              <div className="grid grid-cols-3 gap-2">
                {seedPhrase.split(' ').map((word, index) => (
                  <div key={`${word}-${index}`} className="rounded-xl bg-white/5 px-2 py-2 text-center">
                    <span className="text-[10px] text-fg-3">{index + 1}</span>
                    <p className="font-mono text-xs" data-testid="settings-seed-word">{word}</p>
                  </div>
                ))}
              </div>
            </ModalContent>
            <ModalFooter>
              <div className="flex gap-3">
                <SecondaryButton onClick={() => setConfirmCopySecret('seed')} className="flex-1">Copy</SecondaryButton>
                <PrimaryButton onClick={() => { setShowSeedPhrase(false); setSeedPhrase(''); }} className="flex-1">Done</PrimaryButton>
              </div>
            </ModalFooter>
          </>
        )}
      </Modal>

      <Modal isOpen={showChangePassword} onClose={() => { setShowChangePassword(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}>
        <ModalHeader>Change password</ModalHeader>
        <ModalContent className="space-y-4">
          <div>
            <FieldLabel>Current</FieldLabel>
            <PasswordField
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              data-testid="settings-current-password"
            />
          </div>
          <div>
            <FieldLabel>New</FieldLabel>
            <PasswordField
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              data-testid="settings-new-password"
            />
          </div>
          <div>
            <FieldLabel>Confirm</FieldLabel>
            <PasswordField
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              data-testid="settings-confirm-password"
            />
          </div>
        </ModalContent>
        <ModalFooter>
          <div className="flex gap-3">
            <SecondaryButton onClick={() => setShowChangePassword(false)} className="flex-1">Cancel</SecondaryButton>
            <PrimaryButton onClick={handleChangePassword} className="flex-1" data-testid="settings-password-save">Save</PrimaryButton>
          </div>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={showPrivateKey}
        onClose={() => { setShowPrivateKey(false); setPrivateKey(''); setPassword(''); }}
        focusKey={privateKey ? 'key' : 'password'}
      >
        {!privateKey ? (
          <>
            <ModalHeader>Password required</ModalHeader>
            <ModalContent className="space-y-3">
              <p className="text-sm text-fg-2" data-testid="settings-key-account">
                Export key for {accountAt(accounts, activeAccountIndex)?.name}
              </p>
              <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" onKeyDown={(e) => e.key === 'Enter' && handleExportPrivateKey()} />
            </ModalContent>
            <ModalFooter>
              <div className="flex gap-3">
                <SecondaryButton onClick={() => { setShowPrivateKey(false); setPassword(''); }} className="flex-1">Cancel</SecondaryButton>
                <PrimaryButton onClick={handleExportPrivateKey} className="flex-1">Export</PrimaryButton>
              </div>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader>Private key</ModalHeader>
            <ModalContent className="space-y-4">
              <Banner tone="danger">Anyone with this key can spend from this account.</Banner>
              <p className="break-all rounded-2xl bg-white/5 p-3 font-mono text-xs">{privateKey}</p>
            </ModalContent>
            <ModalFooter>
              <div className="flex gap-3">
                <SecondaryButton onClick={() => setConfirmCopySecret('key')} className="flex-1">Copy</SecondaryButton>
                <PrimaryButton onClick={() => { setShowPrivateKey(false); setPrivateKey(''); }} className="flex-1">Done</PrimaryButton>
              </div>
            </ModalFooter>
          </>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmWipe}
        title="Clear wallet data?"
        body="This removes the vault from this browser. Make sure you have your seed phrase first."
        confirmLabel="Clear data"
        danger
        onClose={() => setConfirmWipe(false)}
        onConfirm={() => {
          setConfirmWipe(false);
          void handleClearData();
        }}
      />

      <ConfirmDialog
        isOpen={!!confirmCopySecret}
        title="Copy secret?"
        body="Clipboard apps can leak this. Only copy if you understand the risk."
        confirmLabel="Copy"
        danger
        onClose={() => setConfirmCopySecret(null)}
        onConfirm={() => {
          const value = confirmCopySecret === 'seed' ? seedPhrase : privateKey;
          navigator.clipboard.writeText(value);
          toast.success('Copied');
          setConfirmCopySecret(null);
        }}
      />
    </div>
  );
}

function SettingRow({
  title,
  description,
  onClick,
  testId,
}: {
  title: string;
  description?: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="flex w-full items-center justify-between rounded-2xl bg-white/5 px-3 py-3 text-left hover:bg-white/8"
    >
      <div>
        <p className="text-sm text-fg-0">{title}</p>
        {description && <p className="text-xs text-fg-2">{description}</p>}
      </div>
      <Icon name="chevron" className="h-4 w-4 text-fg-3" />
    </button>
  );
}
