/// <reference types="chrome" />

// Content script that runs in the context of web pages
console.log('Solana Wallet content script loaded');

// Inject the provider script into the page
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/content/injected.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Set up message relay between page and extension
window.addEventListener('message', async (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;
  
  // Check if it's a wallet message
  if (event.data?.channel !== 'solana-wallet') return;
  
  console.log('Content script received message:', event.data);
  
  try {
    // Forward to background script
    const response = await chrome.runtime.sendMessage({
      type: event.data.type,
      ...event.data.payload,
      origin: window.location.origin
    });
    
    // Send response back to page
    window.postMessage({
      channel: 'solana-wallet',
      id: event.data.id,
      response
    }, '*');
  } catch (error) {
    console.error('Content script error:', error);
    window.postMessage({
      channel: 'solana-wallet',
      id: event.data.id,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, '*');
  }
});

// Listen for account changes from background
chrome.runtime.onMessage.addListener((request, _sender, _sendResponse) => {
  if (request.type === 'ACCOUNTS_CHANGED') {
    // Notify the page of account changes
    window.postMessage({
      channel: 'solana-wallet',
      type: 'accountsChanged',
      accounts: request.accounts
    }, '*');
  }
});

// Establish persistent connection with background
const port = chrome.runtime.connect({ name: 'content-script' });

port.onMessage.addListener((msg) => {
  console.log('Port message from background:', msg);
  
  // Forward events to the page
  if (msg.type === 'event') {
    window.postMessage({
      channel: 'solana-wallet',
      type: msg.eventType,
      data: msg.data
    }, '*');
  }
});

// Clean up on disconnect
port.onDisconnect.addListener(() => {
  console.log('Disconnected from background');
});
