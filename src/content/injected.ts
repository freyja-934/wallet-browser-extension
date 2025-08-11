// This script is injected into the page context to provide window.solana
(() => {
  console.log('Solana Wallet provider injected');
  
  // Message ID counter
  let messageId = 0;
  
  // Pending requests
  const pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }>();
  
  // Provider state
  let isConnected = false;
  let publicKey: string | null = null;
  
  // Event emitter
  class EventEmitter {
    private events: Map<string, Set<Function>> = new Map();
    
    on(event: string, handler: Function): void {
      if (!this.events.has(event)) {
        this.events.set(event, new Set());
      }
      this.events.get(event)!.add(handler);
    }
    
    off(event: string, handler: Function): void {
      this.events.get(event)?.delete(handler);
    }
    
    emit(event: string, ...args: any[]): void {
      this.events.get(event)?.forEach(handler => {
        try {
          handler(...args);
        } catch (error) {
          console.error('Event handler error:', error);
        }
      });
    }
  }
  
  // Solana provider implementation
  class SolanaProvider extends EventEmitter {
    isPhantom = true; // Compatibility flag
    isSolana = true;
    
    constructor() {
      super();
      this.setupMessageListener();
    }
    
    private setupMessageListener(): void {
      window.addEventListener('message', (event) => {
        if (event.data?.channel !== 'solana-wallet') return;
        
        // Handle responses to requests
        if (event.data.id !== undefined && pendingRequests.has(event.data.id)) {
          const { resolve, reject } = pendingRequests.get(event.data.id)!;
          pendingRequests.delete(event.data.id);
          
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve(event.data.response);
          }
        }
        
        // Handle events
        if (event.data.type === 'accountsChanged') {
          this.handleAccountsChanged(event.data.accounts);
        }
      });
    }
    
    private sendMessage(type: string, payload: any = {}): Promise<any> {
      return new Promise((resolve, reject) => {
        const id = messageId++;
        pendingRequests.set(id, { resolve, reject });
        
        window.postMessage({
          channel: 'solana-wallet',
          id,
          type,
          payload
        }, '*');
        
        // Timeout after 30 seconds
        setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error('Request timeout'));
          }
        }, 30000);
      });
    }
    
    private handleAccountsChanged(accounts: string[]): void {
      if (accounts.length > 0) {
        publicKey = accounts[0];
        isConnected = true;
      } else {
        publicKey = null;
        isConnected = false;
      }
      
      this.emit('accountChanged', publicKey ? { publicKey } : null);
    }
    
    // Public methods
    async connect(): Promise<{ publicKey: string }> {
      try {
        const response = await this.sendMessage('WALLET_CONNECT');
        
        if (response.success && response.connected) {
          const accountsResponse = await this.sendMessage('GET_ACCOUNTS');
          if (accountsResponse.success && accountsResponse.accounts.length > 0) {
            publicKey = accountsResponse.accounts[0];
            isConnected = true;
            this.emit('connect', { publicKey });
            return { publicKey: publicKey! };
          }
        }
        
        throw new Error('Failed to connect wallet');
      } catch (error) {
        this.emit('disconnect');
        throw error;
      }
    }
    
    async disconnect(): Promise<void> {
      publicKey = null;
      isConnected = false;
      this.emit('disconnect');
    }
    
    async signTransaction(transaction: any): Promise<any> {
      if (!isConnected) {
        throw new Error('Wallet not connected');
      }
      
      const response = await this.sendMessage('SIGN_TRANSACTION', {
        transaction: transaction.serialize({ requireAllSignatures: false })
      });
      
      if (response.success) {
        return response.signature;
      }
      
      throw new Error('Failed to sign transaction');
    }
    
    async signAllTransactions(transactions: any[]): Promise<any[]> {
      return Promise.all(transactions.map(tx => this.signTransaction(tx)));
    }
    
    async signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }> {
      if (!isConnected) {
        throw new Error('Wallet not connected');
      }
      
      const response = await this.sendMessage('SIGN_MESSAGE', {
        message: Array.from(message)
      });
      
      if (response.success) {
        return { signature: new Uint8Array(response.signature) };
      }
      
      throw new Error('Failed to sign message');
    }
    
    // Getters
    get connected(): boolean {
      return isConnected;
    }
    
    get publicKey(): any {
      if (!publicKey) return null;
      
      // Return a PublicKey-like object for compatibility
      return {
        toString: () => publicKey,
        toBase58: () => publicKey,
        toBuffer: () => {
          // Convert base58 to buffer (simplified)
          return new Uint8Array(32); // Placeholder
        }
      };
    }
  }
  
  // Create and inject the provider
  const provider = new SolanaProvider();
  
  // Define on window
  Object.defineProperty(window, 'solana', {
    value: provider,
    writable: false,
    configurable: false
  });
  
  // Also define on window for compatibility
  Object.defineProperty(window, 'phantom', {
    value: { solana: provider },
    writable: false,
    configurable: false
  });
  
  // Dispatch event to notify dApps
  setTimeout(() => {
    window.dispatchEvent(new Event('solana#initialized'));
  }, 0);
})();
