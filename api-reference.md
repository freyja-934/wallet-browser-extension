# 📚 API Integration Reference

## Helius API Integration

### Setup
```typescript
npm install helius-sdk
```

### Authentication
```typescript
const helius = new Helius("<YOUR_API_KEY>");
```

### Key Endpoints We'll Use

#### 1. Get Token Balances
```typescript
// Get all token balances for a wallet
const balances = await helius.getBalances(walletAddress);

// Response format:
{
  "tokens": [
    {
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "amount": 1000000,
      "decimals": 6,
      "symbol": "USDC",
      "name": "USD Coin",
      "logoURI": "https://..."
    }
  ],
  "nativeBalance": {
    "lamports": 1000000000,
    "sol": 1.0
  }
}
```

#### 2. Get NFTs (including cNFTs)
```typescript
// Get all NFTs including compressed NFTs
const response = await helius.getAssetsByOwner({
  ownerAddress: walletAddress,
  page: 1,
  limit: 1000,
  displayOptions: {
    showFungible: false,
    showCollectionMetadata: true,
    showCompressed: true
  }
});

// Response format:
{
  "items": [
    {
      "id": "asset_id",
      "content": {
        "metadata": {
          "name": "NFT Name",
          "symbol": "SYMBOL",
          "description": "...",
          "image": "https://..."
        }
      },
      "compression": {
        "compressed": true, // true for cNFTs
        "tree": "tree_address",
        "leaf_id": 123
      },
      "grouping": [{
        "group_key": "collection",
        "group_value": "collection_address"
      }],
      "ownership": {
        "owner": "wallet_address"
      }
    }
  ],
  "total": 100,
  "limit": 1000,
  "page": 1
}
```

#### 3. Get Asset Proof (for cNFT transfers)
```typescript
// Required for transferring compressed NFTs
const proof = await helius.getAssetProof({ id: assetId });

// Response format:
{
  "root": "root_hash",
  "proof": ["proof_element_1", "proof_element_2", ...],
  "node_index": 123,
  "leaf": "leaf_hash",
  "tree_id": "tree_address"
}
```

#### 4. Enhanced Transaction History
```typescript
// Get parsed transaction history
const transactions = await helius.getEnhancedTransactions({
  address: walletAddress,
  limit: 100,
  before: "signature", // for pagination
  type: "all" // or specific types like "TRANSFER", "SWAP"
});

// Response format:
{
  "transactions": [
    {
      "signature": "...",
      "timestamp": 1234567890,
      "fee": 5000,
      "feePayer": "...",
      "type": "TRANSFER",
      "source": "SYSTEM_PROGRAM",
      "events": [
        {
          "type": "SOL_TRANSFER",
          "from": "...",
          "to": "...",
          "amount": 1000000000
        }
      ],
      "tokenTransfers": [
        {
          "mint": "...",
          "from": "...",
          "to": "...",
          "amount": 100
        }
      ]
    }
  ]
}
```

#### 5. Webhook Support (for real-time updates)
```typescript
// Register webhook for address
await helius.createWebhook({
  webhookURL: "https://your-endpoint.com/webhook",
  accountAddresses: [walletAddress],
  transactionTypes: ["TRANSFER", "SWAP"],
  webhookType: "enhanced"
});
```

---

## CoinGecko API Integration

### Free Tier Limits
- 50 calls/minute
- No API key required for basic usage

### Key Endpoints

#### 1. Get Token Prices by Contract Address
```typescript
// Batch request for multiple tokens
const response = await fetch(
  `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${addresses.join(',')}&vs_currencies=usd&include_24hr_change=true`
);

// Response format:
{
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": {
    "usd": 1.00,
    "usd_24h_change": 0.05
  },
  "So11111111111111111111111111111111111111112": {
    "usd": 150.25,
    "usd_24h_change": 2.45
  }
}
```

#### 2. Get SOL Price
```typescript
const response = await fetch(
  'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true'
);

// Response format:
{
  "solana": {
    "usd": 150.25,
    "usd_24h_change": 2.45
  }
}
```

#### 3. Get Historical Prices (for charts)
```typescript
const response = await fetch(
  `https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=7`
);

// Response format:
{
  "prices": [[timestamp, price], ...],
  "market_caps": [[timestamp, cap], ...],
  "total_volumes": [[timestamp, volume], ...]
}
```

---

## Jupiter API Integration (for swaps)

### Setup
```typescript
const JUPITER_API = "https://quote-api.jup.ag/v6";
```

#### 1. Get Swap Quote
```typescript
const quote = await fetch(
  `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
);

// Response format:
{
  "inputMint": "...",
  "outputMint": "...",
  "inAmount": "1000000",
  "outAmount": "995000",
  "priceImpactPct": "0.05",
  "routePlan": [
    {
      "swapInfo": {
        "ammKey": "...",
        "label": "Raydium",
        "inputMint": "...",
        "outputMint": "...",
        "inAmount": "1000000",
        "outAmount": "995000"
      }
    }
  ]
}
```

#### 2. Get Swap Transaction
```typescript
const swapResponse = await fetch(`${JUPITER_API}/swap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: walletAddress,
    wrapAndUnwrapSol: true,
    computeUnitPriceMicroLamports: 50000 // priority fee
  })
});

// Response format:
{
  "swapTransaction": "base64_encoded_transaction",
  "lastValidBlockHeight": 123456,
  "prioritizationType": {
    "computeUnitLimit": 200000,
    "computeUnitPrice": "50000"
  }
}
```

---

## Rate Limiting Strategy

```typescript
class RateLimiter {
  private queues = new Map<string, Array<() => Promise<any>>>();
  private processing = new Map<string, boolean>();
  
  constructor(private limits: Record<string, { calls: number, period: number }>) {}
  
  async execute<T>(api: string, fn: () => Promise<T>): Promise<T> {
    if (!this.queues.has(api)) {
      this.queues.set(api, []);
    }
    
    return new Promise((resolve, reject) => {
      this.queues.get(api)!.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.processQueue(api);
    });
  }
  
  private async processQueue(api: string) {
    if (this.processing.get(api)) return;
    this.processing.set(api, true);
    
    const queue = this.queues.get(api)!;
    const limit = this.limits[api];
    
    while (queue.length > 0) {
      const batch = queue.splice(0, limit.calls);
      await Promise.all(batch.map(fn => fn()));
      
      if (queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, limit.period));
      }
    }
    
    this.processing.set(api, false);
  }
}

// Usage
const rateLimiter = new RateLimiter({
  coingecko: { calls: 50, period: 60000 }, // 50 calls per minute
  helius: { calls: 100, period: 1000 } // 100 calls per second
});

const price = await rateLimiter.execute('coingecko', () => 
  fetch(`https://api.coingecko.com/...`)
);
```

---

## Error Handling

```typescript
class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public api: string,
    public endpoint: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

async function apiCall<T>(
  api: string,
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(endpoint, options);
    
    if (!response.ok) {
      throw new APIError(
        `${api} API error: ${response.statusText}`,
        response.status,
        api,
        endpoint
      );
    }
    
    return await response.json();
  } catch (error) {
    if (error instanceof APIError) throw error;
    
    throw new APIError(
      `Network error calling ${api}`,
      0,
      api,
      endpoint
    );
  }
}
```

This reference guide provides all the API endpoints and response formats needed to implement the wallet features.
