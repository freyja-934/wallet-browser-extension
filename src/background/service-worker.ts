/// <reference types="chrome" />

// Service worker for handling extension background tasks
console.log('Solana Wallet service worker initialized');

// Track active tabs and connections
const activeTabs = new Set<number>();
const portConnections = new Map<string, chrome.runtime.Port>();

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details);
  
  // Set default storage values
  chrome.storage.local.set({
    isInitialized: false,
    network: 'mainnet-beta',
  });
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log('Background received message:', request.type);
  
  // Handle async responses
  (async () => {
    try {
      switch (request.type) {
        case 'WALLET_CONNECT':
          // Handle wallet connection request from dApp
          const connected = await handleWalletConnect(request.origin);
          sendResponse({ success: true, connected });
          break;
          
        case 'SIGN_TRANSACTION':
          // Handle transaction signing request
          const signature = await handleSignTransaction(request.transaction);
          sendResponse({ success: true, signature });
          break;
          
        case 'GET_ACCOUNTS':
          // Get current accounts
          const accounts = await getAccounts();
          sendResponse({ success: true, accounts });
          break;
          
        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Background script error:', error);
      sendResponse({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  })();
  
  // Return true to indicate async response
  return true;
});

// Handle port connections for persistent communication
chrome.runtime.onConnect.addListener((port) => {
  console.log('Port connected:', port.name);
  
  const tabId = port.sender?.tab?.id;
  if (!tabId) return;
  
  portConnections.set(`${tabId}-${port.name}`, port);
  
  port.onMessage.addListener((msg) => {
    console.log('Port message:', msg);
    // Handle persistent connection messages
  });
  
  port.onDisconnect.addListener(() => {
    console.log('Port disconnected:', port.name);
    portConnections.delete(`${tabId}-${port.name}`);
  });
});

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Check if this is a dApp that might need wallet injection
    if (shouldInjectWallet(tab.url)) {
      activeTabs.add(tabId);
    }
  }
});

// Handle tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
  // Clean up any connections for this tab
  for (const [key, port] of portConnections.entries()) {
    if (key.startsWith(`${tabId}-`)) {
      port.disconnect();
      portConnections.delete(key);
    }
  }
});

// Helper functions
async function handleWalletConnect(_origin: string): Promise<boolean> {
  // Check if wallet is unlocked
  const { isLocked } = await chrome.storage.local.get('isLocked');
  
  if (isLocked) {
    // Open popup for user to unlock
    chrome.action.openPopup();
    return false;
  }
  
  // TODO: Show connection approval dialog
  return true;
}

async function handleSignTransaction(_transaction: any): Promise<string> {
  // TODO: Implement transaction signing
  // This will communicate with the popup for user approval
  return 'mock-signature';
}

async function getAccounts(): Promise<string[]> {
  const { accounts, isLocked } = await chrome.storage.local.get(['accounts', 'isLocked']);
  
  if (isLocked || !accounts) {
    return [];
  }
  
  return accounts.map((acc: any) => acc.address);
}

function shouldInjectWallet(url: string): boolean {
  // List of known dApp domains or patterns
  const dAppPatterns = [
    'localhost',
    '127.0.0.1',
    'solana',
    'dex',
    'defi',
    'nft',
    // Add more patterns as needed
  ];
  
  try {
    const urlObj = new URL(url);
    return dAppPatterns.some(pattern => 
      urlObj.hostname.includes(pattern) || 
      urlObj.href.includes(pattern)
    );
  } catch {
    return false;
  }
}

// Listen for extension icon clicks
chrome.action.onClicked.addListener((_tab) => {
  // This won't fire if we have a default_popup set
  // But useful for programmatic popup opening
  console.log('Extension icon clicked');
});

// Export for use in other background modules
export { activeTabs, portConnections };
