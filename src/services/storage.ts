import { IDBPDatabase, openDB } from 'idb';
import { decrypt, encrypt, EncryptedData } from '../lib/encryption-simple';

const DB_NAME = 'SolanaWalletVault';
const DB_VERSION = 1;
const VAULT_STORE = 'vaults';
const SESSION_STORE = 'sessions';
const SETTINGS_STORE = 'settings';

export interface Vault {
  id: string;
  encryptedSeed: EncryptedData;
  encryptedAccounts: EncryptedData;
  createdAt: number;
  lastAccessed: number;
}

export interface SessionData {
  id: string;
  expiresAt: number;
  encryptedKey: string;
}

export interface WalletSettings {
  autoLockTimeout: number; // minutes
  preferredCurrency: string;
  theme: 'light' | 'dark' | 'system';
  hideSmallBalances: boolean;
  smallBalanceThreshold: number;
}

class SecureStorage {
  private db: IDBPDatabase | null = null;
  private sessionKey: string | null = null;
  private sessionTimeout: NodeJS.Timeout | null = null;

  async initialize(): Promise<void> {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Vault store for encrypted wallet data
        if (!db.objectStoreNames.contains(VAULT_STORE)) {
          db.createObjectStore(VAULT_STORE, { keyPath: 'id' });
        }
        
        // Session store for temporary decryption keys
        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
        }
        
        // Settings store
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
      },
    });
  }

  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
  }

  /**
   * Creates or updates the wallet vault
   */
  async createVault(
    seedPhrase: string,
    accounts: any[],
    password: string
  ): Promise<void> {
    this.ensureInitialized();
    
    // Encrypt sensitive data
    const encryptedSeed = await encrypt(seedPhrase, password);
    const encryptedAccounts = await encrypt(
      JSON.stringify(accounts),
      password
    );
    
    const vault: Vault = {
      id: 'primary',
      encryptedSeed,
      encryptedAccounts,
      createdAt: Date.now(),
      lastAccessed: Date.now()
    };
    
    await this.db!.put(VAULT_STORE, vault);
    
    // Also backup to Chrome storage
    await this.backupToChrome(vault);
  }

  /**
   * Checks if a vault exists
   */
  async hasVault(): Promise<boolean> {
    this.ensureInitialized();
    const vault = await this.db!.get(VAULT_STORE, 'primary');
    return !!vault;
  }

  /**
   * Unlocks the vault and creates a session
   */
  async unlock(password: string): Promise<{
    seedPhrase: string;
    accounts: any[];
  }> {
    this.ensureInitialized();
    
    const vault = await this.db!.get(VAULT_STORE, 'primary');
    if (!vault) {
      throw new Error('No wallet found');
    }
    
    try {
      // Decrypt the vault
      const decryptedSeed = await decrypt(vault.encryptedSeed, password);
      const seedPhrase = new TextDecoder().decode(decryptedSeed);
      
      const decryptedAccounts = await decrypt(vault.encryptedAccounts, password);
      const accounts = JSON.parse(new TextDecoder().decode(decryptedAccounts));
      
      // Create session
      await this.createSession(password);
      
      // Update last accessed
      vault.lastAccessed = Date.now();
      await this.db!.put(VAULT_STORE, vault);
      
      return { seedPhrase, accounts };
    } catch (error) {
      throw new Error('Invalid password');
    }
  }

  /**
   * Creates a temporary session
   */
  private async createSession(password: string): Promise<void> {
    const timeout = await this.getAutoLockTimeout();
    const expiresAt = Date.now() + (timeout * 60 * 1000);
    
    this.sessionKey = password;
    
    // Store encrypted session data
    const session: SessionData = {
      id: 'current',
      expiresAt,
      encryptedKey: btoa(password) // Simple encoding for session
    };
    
    await this.db!.put(SESSION_STORE, session);
    
    // Set auto-lock timer
    this.resetSessionTimeout();
  }

  /**
   * Checks if session is active
   */
  async isUnlocked(): Promise<boolean> {
    if (!this.db) return false;
    
    const session = await this.db.get(SESSION_STORE, 'current');
    if (!session || Date.now() > session.expiresAt) {
      await this.lock();
      return false;
    }
    
    return true;
  }

  /**
   * Locks the wallet
   */
  async lock(): Promise<void> {
    this.sessionKey = null;
    
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
    
    if (this.db) {
      await this.db.delete(SESSION_STORE, 'current');
    }
  }

  /**
   * Resets the session timeout
   */
  private resetSessionTimeout(): void {
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
    }
    
    this.getAutoLockTimeout().then(timeout => {
      this.sessionTimeout = setTimeout(() => {
        this.lock();
      }, timeout * 60 * 1000);
    });
  }

  /**
   * Gets decrypted data if session is active
   */
  async getDecryptedVault(): Promise<{
    seedPhrase: string;
    accounts: any[];
  } | null> {
    if (!await this.isUnlocked() || !this.sessionKey) {
      return null;
    }
    
    const vault = await this.db!.get(VAULT_STORE, 'primary');
    if (!vault) return null;
    
    try {
      const decryptedSeed = await decrypt(vault.encryptedSeed, this.sessionKey);
      const seedPhrase = new TextDecoder().decode(decryptedSeed);
      
      const decryptedAccounts = await decrypt(vault.encryptedAccounts, this.sessionKey);
      const accounts = JSON.parse(new TextDecoder().decode(decryptedAccounts));
      
      // Reset timeout on access
      this.resetSessionTimeout();
      
      return { seedPhrase, accounts };
    } catch {
      await this.lock();
      return null;
    }
  }

  /**
   * Updates accounts in the vault
   */
  async updateAccounts(accounts: any[]): Promise<void> {
    if (!this.sessionKey) {
      throw new Error('Wallet is locked');
    }
    
    const vault = await this.db!.get(VAULT_STORE, 'primary');
    if (!vault) {
      throw new Error('No vault found');
    }
    
    vault.encryptedAccounts = await encrypt(
      JSON.stringify(accounts),
      this.sessionKey
    );
    vault.lastAccessed = Date.now();
    
    await this.db!.put(VAULT_STORE, vault);
    await this.backupToChrome(vault);
  }

  /**
   * Backs up vault to Chrome storage
   */
  private async backupToChrome(vault: Vault): Promise<void> {
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({
        vault: JSON.stringify(vault),
        backupDate: Date.now()
      });
    }
  }

  /**
   * Restores vault from Chrome storage
   */
  async restoreFromChrome(): Promise<boolean> {
    if (!chrome?.storage?.local) return false;
    
    const data = await chrome.storage.local.get(['vault']);
    if (!data.vault) return false;
    
    try {
      const vault = JSON.parse(data.vault) as Vault;
      await this.db!.put(VAULT_STORE, vault);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets wallet settings
   */
  async getSettings(): Promise<WalletSettings> {
    this.ensureInitialized();
    
    const settings = await this.db!.get(SETTINGS_STORE, 'walletSettings');
    return settings?.value || {
      autoLockTimeout: 15, // 15 minutes default
      preferredCurrency: 'USD',
      theme: 'system',
      hideSmallBalances: false,
      smallBalanceThreshold: 1
    };
  }

  /**
   * Updates wallet settings
   */
  async updateSettings(settings: Partial<WalletSettings>): Promise<void> {
    this.ensureInitialized();
    
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    
    await this.db!.put(SETTINGS_STORE, {
      key: 'walletSettings',
      value: updated
    });
    
    // Update Chrome storage
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ settings: updated });
    }
  }

  /**
   * Gets auto-lock timeout in minutes
   */
  async getAutoLockTimeout(): Promise<number> {
    const settings = await this.getSettings();
    return settings.autoLockTimeout;
  }

  /**
   * Completely removes the wallet
   */
  async removeWallet(): Promise<void> {
    await this.lock();
    
    if (this.db) {
      await this.db.delete(VAULT_STORE, 'primary');
      await this.db.clear(SESSION_STORE);
    }
    
    // Clear Chrome storage
    if (chrome?.storage?.local) {
      await chrome.storage.local.clear();
    }
  }

  /**
   * Changes the password
   */
  async updatePassword(currentPassword: string, newPassword: string): Promise<void> {
    // First unlock with current password to verify
    const decryptedData = await this.unlock(currentPassword);
    
    // Re-encrypt with new password
    await this.createVault(
      decryptedData.seedPhrase,
      decryptedData.accounts,
      newPassword
    );
    
    // Update session with new password
    this.sessionKey = newPassword;
    await this.createSession(newPassword);
  }

  /**
   * Clears all wallet data
   */
  async clear(): Promise<void> {
    await this.removeWallet();
  }
}

// Export singleton instance
export const secureStorage = new SecureStorage();
