import { fromSmallestUnit } from './units';

export type NativeTransfer = {
  from: string;
  to: string;
  amount: number;
};

export type TokenTransfer = {
  mint: string;
  from: string;
  to: string;
  amount: string;
  decimals: number;
};

export type ParsedIx = {
  program?: string;
  parsed?: {
    type?: string;
    info?: Record<string, unknown>;
  };
};

export type TokenBalanceRow = {
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
  };
};

export type ParsedTxInput = {
  meta: {
    err: unknown;
    fee: number;
    preTokenBalances?: TokenBalanceRow[] | null;
    postTokenBalances?: TokenBalanceRow[] | null;
    innerInstructions?: Array<{ instructions: unknown[] }> | null;
  } | null;
  transaction: {
    message: {
      instructions: unknown[];
    };
  };
};

export type ActivityTransfers = {
  type: string;
  nativeTransfers: NativeTransfer[];
  tokenTransfers: TokenTransfer[];
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asLamports(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function asParsedIx(ix: unknown): ParsedIx {
  return ix && typeof ix === 'object' ? ix as ParsedIx : {};
}

function allInstructions(tx: ParsedTxInput): ParsedIx[] {
  const inner = tx.meta?.innerInstructions?.flatMap((group) => group.instructions) ?? [];
  return [...tx.transaction.message.instructions, ...inner].map(asParsedIx);
}

function nativeFromInstructions(tx: ParsedTxInput, owner: string): NativeTransfer[] {
  const transfers: NativeTransfer[] = [];
  for (const ix of allInstructions(tx)) {
    const type = ix.parsed?.type;
    if (ix.program !== 'system' || (type !== 'transfer' && type !== 'transferWithSeed')) continue;
    const info = ix.parsed?.info ?? {};
    const from = asString(info.source);
    const to = asString(info.destination);
    const amount = asLamports(info.lamports);
    if (!from || !to) continue;
    if (from === owner || to === owner) {
      transfers.push({ from, to, amount });
    }
  }
  return transfers;
}

function ownerTokenMeta(tx: ParsedTxInput, owner: string): TokenBalanceRow[] {
  return [
    ...(tx.meta?.preTokenBalances ?? []),
    ...(tx.meta?.postTokenBalances ?? []),
  ].filter((row) => row.owner === owner);
}

function tokenFromInstructions(tx: ParsedTxInput, owner: string): TokenTransfer[] {
  const metaRows = ownerTokenMeta(tx, owner);
  const transfers: TokenTransfer[] = [];
  for (const ix of allInstructions(tx)) {
    if (ix.program !== 'spl-token' && ix.program !== 'spl-token-2022') continue;
    const type = ix.parsed?.type;
    if (type !== 'transfer' && type !== 'transferChecked') continue;
    const info = ix.parsed?.info ?? {};
    const authority = asString(info.authority);
    if (authority !== owner) continue;
    const tokenAmount = info.tokenAmount as { amount?: unknown; decimals?: unknown } | undefined;
    const amount = asString(tokenAmount?.amount ?? info.amount);
    if (!amount || amount === '0') continue;
    const mint = asString(info.mint) || metaRows.find((row) => row.mint)?.mint || '';
    const matched = metaRows.find((row) => !mint || row.mint === mint);
    transfers.push({
      mint: mint || matched?.mint || '',
      from: owner,
      to: owner,
      amount,
      decimals: Number(tokenAmount?.decimals ?? matched?.uiTokenAmount.decimals ?? 0),
    });
  }
  return transfers;
}

function tokenFromBalances(tx: ParsedTxInput, owner: string): TokenTransfer[] {
  const meta = tx.meta;
  if (!meta) return [];

  type Delta = { mint: string; owner: string; pre: bigint; post: bigint; decimals: number };
  const byOwnerMint = new Map<string, Delta>();

  const ingest = (rows: TokenBalanceRow[] | null | undefined, side: 'pre' | 'post') => {
    for (const row of rows ?? []) {
      if (!row.owner) continue;
      const key = `${row.mint}:${row.owner}`;
      const current = byOwnerMint.get(key) ?? {
        mint: row.mint,
        owner: row.owner,
        pre: 0n,
        post: 0n,
        decimals: row.uiTokenAmount.decimals,
      };
      const raw = BigInt(row.uiTokenAmount.amount || '0');
      if (side === 'pre') current.pre = raw;
      else current.post = raw;
      current.decimals = row.uiTokenAmount.decimals;
      byOwnerMint.set(key, current);
    }
  };

  ingest(meta.preTokenBalances, 'pre');
  ingest(meta.postTokenBalances, 'post');

  const deltas = [...byOwnerMint.values()]
    .map((row) => ({ ...row, delta: row.post - row.pre }))
    .filter((row) => row.delta !== 0n);

  const ours = deltas.filter((row) => row.owner === owner);
  const others = deltas.filter((row) => row.owner !== owner);

  return ours.map((row) => {
    const counter = others.find((other) => other.mint === row.mint && other.delta === -row.delta)
      ?? others.find((other) => other.mint === row.mint && (other.delta > 0n) !== (row.delta > 0n));
    const sent = row.delta < 0n;
    return {
      mint: row.mint,
      from: sent ? owner : (counter?.owner ?? ''),
      to: sent ? (counter?.owner ?? '') : owner,
      amount: (sent ? -row.delta : row.delta).toString(),
      decimals: row.decimals,
    };
  });
}

export function activityFromParsedTx(tx: ParsedTxInput, owner: string): ActivityTransfers {
  const nativeTransfers = nativeFromInstructions(tx, owner);
  const tokenTransfers = tokenFromBalances(tx, owner);
  const tokens = tokenTransfers.length > 0 ? tokenTransfers : tokenFromInstructions(tx, owner);
  const nativeMoved = nativeTransfers.some((transfer) => transfer.amount > 0);
  const type = nativeMoved ? 'TRANSFER' : tokens.length > 0 ? 'TOKEN_TRANSFER' : 'unknown';
  return { type, nativeTransfers, tokenTransfers: tokens };
}

/** The rows of one transfer list, or none at all: an HTTP body can carry anything. */
function transferRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object');
}

/**
 * The transfers of one enhanced-transaction row. Both lists come off an HTTP
 * body nothing has checked, so a missing, non-array, or non-object entry is
 * dropped rather than read.
 */
export function normalizeHeliusTransfers(tx: {
  nativeTransfers?: unknown;
  tokenTransfers?: unknown;
}): { nativeTransfers: NativeTransfer[]; tokenTransfers: TokenTransfer[] } {
  return {
    nativeTransfers: transferRows(tx.nativeTransfers).map((row) => ({
      from: asString(row.fromUserAccount ?? row.from),
      to: asString(row.toUserAccount ?? row.to),
      amount: asLamports(row.amount),
    })),
    tokenTransfers: transferRows(tx.tokenTransfers).map((row) => {
      const rawAmount = row.rawTokenAmount;
      const raw = (rawAmount !== null && typeof rawAmount === 'object' ? rawAmount : undefined) as
        | { tokenAmount?: unknown; decimals?: unknown }
        | undefined;
      return {
        mint: asString(row.mint),
        from: asString(row.fromUserAccount ?? row.from),
        to: asString(row.toUserAccount ?? row.to),
        amount: asString(raw?.tokenAmount ?? row.tokenAmount ?? row.amount ?? '0'),
        decimals: Number(raw?.decimals ?? row.decimals ?? 0),
      };
    }),
  };
}

export function displayTokenAmount(amount: string, decimals: number): string {
  if (!amount) return '0';
  if (amount.includes('.')) return amount;
  try {
    return fromSmallestUnit(BigInt(amount), decimals);
  } catch {
    return amount;
  }
}

const KNOWN_MINT_SYMBOLS: Record<string, string> = {
  Fbfa7UPLAfng7Wkvr2qCrZVPqEwMzLFPvD8McPRfhBkS: 'CNDR',
};

export function shortMintLabel(mint: string): string {
  if (!mint) return 'token';
  return KNOWN_MINT_SYMBOLS[mint] ?? `${mint.slice(0, 4)}…`;
}
