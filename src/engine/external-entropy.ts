/**
 * external-entropy.ts — public, operator-unpredictable entropy for player-less
 * rounds (the last anti-genesis-grind gap).
 *
 * Player commit–reveal already binds the client seed for any round WITH bets.
 * But an empty round (no contributions) would fall back to chain-determined
 * entropy, which a maximally-adversarial operator could grind at genesis time.
 * Mixing in a value the operator could NOT have known when it built the seed
 * chain — a blockchain block hash minted AFTER the chain terminal was published —
 * closes that: the outcome depends on data that did not exist at grind time.
 *
 * Design notes
 * - Best-effort + RESILIENT: the provider is polled during the betting window; if
 *   the feed is slow or down, `forRound` returns null and the round falls back to
 *   player/chained entropy. A network blip never stalls or breaks a round.
 * - The fetched hash is the PUBLIC value disclosed at betting close, so anyone can
 *   independently re-fetch the block and recompute the client seed.
 * - `fetchTipHash` is injectable for deterministic tests.
 */

export interface ExternalEntropy {
  /** Human label for disclosure (e.g. "bitcoin-tip"). */
  source: string;
  /** The public entropy value (hex block hash). */
  value: string;
}

export interface ExternalEntropyProvider {
  /** Public entropy for a round, or null if unavailable (round falls back). */
  forRound(roundNumber: number): Promise<ExternalEntropy | null>;
  describe(): string;
}

export interface BlockHashOptions {
  /** Returns the latest block hash (hex). Default: Bitcoin tip via blockstream.info. */
  fetchTipHash?: () => Promise<string>;
  /** Reuse a fetched hash for this long (ms) to avoid hammering the feed. */
  ttlMs?: number;
  /** Disclosure label. */
  source?: string;
  /** Injectable clock for tests. */
  now?: () => number;
}

export class BlockHashEntropyProvider implements ExternalEntropyProvider {
  private fetchTipHash: () => Promise<string>;
  private ttlMs: number;
  private sourceName: string;
  private now: () => number;
  private cache: { value: string; at: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(opts: BlockHashOptions = {}) {
    this.fetchTipHash = opts.fetchTipHash ?? defaultBitcoinTipFetch;
    this.ttlMs = opts.ttlMs ?? 30_000;
    this.sourceName = opts.source ?? "bitcoin-tip (blockstream.info)";
    this.now = opts.now ?? (() => Date.now());
  }

  async forRound(_roundNumber: number): Promise<ExternalEntropy | null> {
    try {
      const value = await this.tip();
      return value ? { source: this.sourceName, value } : null;
    } catch {
      return null; // resilient: never break a round on a feed hiccup
    }
  }

  private tip(): Promise<string> {
    const t = this.now();
    if (this.cache && t - this.cache.at < this.ttlMs) return Promise.resolve(this.cache.value);
    if (!this.inflight) {
      this.inflight = this.fetchTipHash()
        .then((v) => { const clean = v.trim(); this.cache = { value: clean, at: this.now() }; return clean; })
        .finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  describe(): string {
    return `external entropy = ${this.sourceName} block hash, minted after the chain terminal ` +
      `(refreshed every ${Math.round(this.ttlMs / 1000)}s). Makes player-less rounds genesis-grind-proof.`;
  }
}

async function defaultBitcoinTipFetch(): Promise<string> {
  const res = await fetch("https://blockstream.info/api/blocks/tip/hash");
  if (!res.ok) throw new Error(`tip fetch ${res.status}`);
  return (await res.text()).trim();
}
