/**
 * provablyfair.ts — commit/reveal fairness for Ascent.
 *
 * PURE logic. No DOM, no Node APIs, no async. A self-contained synchronous
 * SHA-256 + HMAC-SHA256 so the exact same code derives outcomes in the browser
 * client, the mock RGS, and the test suite — and so anyone can re-run verify()
 * offline against the published seeds.
 *
 * Scheme
 * ------
 *  - The server generates a random `serverSeed` and publishes commitment =
 *    SHA-256(serverSeed) BEFORE the round opens. The player can record it.
 *  - The player contributes a `clientSeed`. A monotonic `nonce` separates rounds
 *    that share a server seed.
 *  - Two INDEPENDENT outcome streams are derived from the SAME committed seed via
 *    distinct HMAC message tags:
 *        crash float    = float( HMAC-SHA256(serverSeed, "clientSeed:nonce:crash") )
 *        moonpool float = float( HMAC-SHA256(serverSeed, "clientSeed:nonce:moonpool") )
 *    Different tag => different keystream, so the jackpot roll cannot be inferred
 *    from the crash point (and vice-versa), yet both are bound to one commitment.
 *  - After the round the server reveals `serverSeed`. Anyone checks
 *    SHA-256(serverSeed) === commitment, then recomputes both outcomes.
 *
 * In production the RGS owns seed generation and reveal timing. This module is
 * the shared verifier; the client never uses it to DECIDE anything.
 */

// ----------------------------------------------------------------------------
// Byte / hex / utf-8 helpers
// ----------------------------------------------------------------------------

export function utf8Bytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      // surrogate pair
      const c2 = s.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 ? "0" + hex : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toBytes(input: Uint8Array | string): Uint8Array {
  return typeof input === "string" ? utf8Bytes(input) : input;
}

// ----------------------------------------------------------------------------
// SHA-256 (FIPS 180-4), pure, synchronous
// ----------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256(input: Uint8Array | string): Uint8Array {
  const msg = toBytes(input);
  const len = msg.length;
  const bitLen = len * 8;

  // padding: 0x80, then zeros, then 64-bit big-endian length
  const withPad = ((len + 8) >> 6) + 1; // number of 512-bit blocks
  const total = withPad * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  // 64-bit length: high word (we only support < 2^32 byte messages safely)
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  buf[total - 8] = (hi >>> 24) & 0xff;
  buf[total - 7] = (hi >>> 16) & 0xff;
  buf[total - 6] = (hi >>> 8) & 0xff;
  buf[total - 5] = hi & 0xff;
  buf[total - 4] = (lo >>> 24) & 0xff;
  buf[total - 3] = (lo >>> 16) & 0xff;
  buf[total - 2] = (lo >>> 8) & 0xff;
  buf[total - 1] = lo & 0xff;

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const out = new Uint8Array(32);
  const hs = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (hs[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (hs[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (hs[i] >>> 8) & 0xff;
    out[i * 4 + 3] = hs[i] & 0xff;
  }
  return out;
}

export function sha256hex(input: Uint8Array | string): string {
  return bytesToHex(sha256(input));
}

// ----------------------------------------------------------------------------
// HMAC-SHA256 (RFC 2104)
// ----------------------------------------------------------------------------

const BLOCK = 64;

export function hmacSha256(key: Uint8Array | string, msg: Uint8Array | string): Uint8Array {
  let k = toBytes(key);
  if (k.length > BLOCK) k = sha256(k);
  const padded = new Uint8Array(BLOCK);
  padded.set(k);

  const ipad = new Uint8Array(BLOCK);
  const opad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    ipad[i] = padded[i] ^ 0x36;
    opad[i] = padded[i] ^ 0x5c;
  }

  const m = toBytes(msg);
  const inner = new Uint8Array(BLOCK + m.length);
  inner.set(ipad);
  inner.set(m, BLOCK);
  const innerHash = sha256(inner);

  const outer = new Uint8Array(BLOCK + 32);
  outer.set(opad);
  outer.set(innerHash, BLOCK);
  return sha256(outer);
}

export function hmacSha256hex(key: Uint8Array | string, msg: Uint8Array | string): string {
  return bytesToHex(hmacSha256(key, msg));
}

// ----------------------------------------------------------------------------
// Outcome derivation
// ----------------------------------------------------------------------------

/** Tags that separate the independent outcome streams of a single round. */
export const TAG_CRASH = "crash";
export const TAG_MOONPOOL = "moonpool";

export interface RoundSeeds {
  serverSeed: string; // hex, secret until reveal
  clientSeed: string; // chosen by player / client
  nonce: number; // round counter
}

/** SHA-256 commitment published before the round. */
export function commit(serverSeed: string): string {
  return sha256hex(serverSeed);
}

/** Confirm a revealed server seed matches its pre-published commitment. */
export function verifyCommit(serverSeed: string, commitment: string): boolean {
  return sha256hex(serverSeed) === commitment.toLowerCase();
}

/**
 * Derive a uniform float in [0, 1) for a given tag, from the first 48 bits of
 * HMAC-SHA256(serverSeed, "clientSeed:nonce:tag"). 48 bits stays well inside
 * JS safe-integer range and gives ~2.8e14 distinct values — plenty.
 */
export function floatFor(seeds: RoundSeeds, tag: string): number {
  const mac = hmacSha256(seeds.serverSeed, `${seeds.clientSeed}:${seeds.nonce}:${tag}`);
  let r = 0;
  for (let i = 0; i < 6; i++) r = r * 256 + mac[i];
  return r / 0x1000000000000; // 2^48
}

/**
 * Derive a non-negative integer < `mod` for a given tag. Used for the Moon Pool
 * trigger roll. The 48-bit source over a small modulus has negligible bias.
 */
export function intFor(seeds: RoundSeeds, tag: string, mod: number): number {
  const mac = hmacSha256(seeds.serverSeed, `${seeds.clientSeed}:${seeds.nonce}:${tag}`);
  let r = 0;
  for (let i = 0; i < 6; i++) r = r * 256 + mac[i];
  return r % mod;
}
