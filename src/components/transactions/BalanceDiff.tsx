import type { PreviewDiff } from '../../lib/preview';
import { formatLamports, fromSmallestUnit } from '../../lib/units';
import { Banner } from '../ui/EmptyState';

/**
 * What the simulation says the active account's balances become if the
 * transaction lands. Amounts stay integers until they are rendered; the sign
 * of the change picks the colour, and a SOL change equal to the fee is named
 * as the fee so a self-transfer does not read as money leaving.
 */
export function BalanceDiff({ diff }: { diff: PreviewDiff }) {
  const solPre = BigInt(diff.sol.pre);
  const solPost = BigInt(diff.sol.post);
  const solDelta = solPost - solPre;
  const fee = BigInt(diff.fee);
  const feeOnly = solDelta === -fee && fee > 0n;

  return (
    <div className="space-y-2" data-testid="balance-diff">
      <p className="text-[11px] uppercase tracking-[0.18em] text-fg-2">Balance changes</p>
      <Row
        testId="balance-diff-sol"
        label="SOL"
        pre={formatLamports(solPre)}
        post={formatLamports(solPost)}
        delta={solDelta}
        deltaText={`${signed(formatLamports(solDelta))} SOL`}
        note={feeOnly ? 'network fee' : undefined}
      />
      {diff.tokens.map((row) => {
        const pre = BigInt(row.pre);
        const post = BigInt(row.post);
        const delta = post - pre;
        const format = (value: bigint) => (row.decimals === null ? value.toString() : fromSmallestUnit(value, row.decimals));
        return (
          <Row
            key={`${row.programId}:${row.mint}`}
            testId="balance-diff-token"
            label={shortMint(row.mint)}
            pre={format(pre)}
            post={format(post)}
            delta={delta}
            deltaText={signed(format(delta))}
            note={row.decimals === null ? 'base units' : undefined}
          />
        );
      })}
      {diff.partial && (
        <Banner tone="info">
          Only the first accounts this transaction writes were simulated; other balance changes may not be shown.
        </Banner>
      )}
    </div>
  );
}

function Row({
  testId,
  label,
  pre,
  post,
  delta,
  deltaText,
  note,
}: {
  testId: string;
  label: string;
  pre: string;
  post: string;
  delta: bigint;
  deltaText: string;
  note?: string;
}) {
  const tone = delta < 0n ? 'text-ui-danger' : delta > 0n ? 'text-ui-success' : 'text-fg-2';
  const sign = delta < 0n ? 'negative' : delta > 0n ? 'positive' : 'zero';
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm" data-testid={testId} data-sign={sign}>
      <span className="text-fg-1">{label}</span>
      <span className="text-right">
        <span className="font-mono text-xs text-fg-2">
          {pre} → {post}
        </span>
        <span className={`ml-2 font-mono text-xs ${tone}`} data-testid={`${testId}-delta`}>
          {deltaText}
        </span>
        {note && <span className="ml-1 text-[11px] text-fg-3">({note})</span>}
      </span>
    </div>
  );
}

/** A leading `+` for an increase; `fromSmallestUnit` already writes the `-`. */
function signed(text: string): string {
  return text.startsWith('-') || text === '0' ? text : `+${text}`;
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
