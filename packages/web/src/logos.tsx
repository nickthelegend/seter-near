// Token logos. NEAR is bundled from @web3icons/core 4.0.58 (MIT, https://github.com/0xa3k5/web3icons), branded variant,
// rendered as a data-URI <img> so no SVG ids leak into the page. The quote asset is the US dollar (Coinbase NEAR-USD);
// fiat USD has no mark in that package, so it gets a plain dollar disc. tUSD is Seter's test token with no value: it shows
// the dollar disc plus a "test" tag, never a real stablecoin's logo.
import NEAR from '@web3icons/core/svgs/tokens/branded/NEAR.svg.js';

const NEAR_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(NEAR)}`;

const Dollar = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#2f8a57" /><path d="M12 5.2v13.6M15.3 8.6c-.5-1.1-1.7-1.8-3.3-1.8-1.9 0-3.2 1-3.2 2.5 0 3.5 6.6 1.9 6.6 5.4 0 1.5-1.4 2.6-3.4 2.6-1.6 0-2.9-.7-3.5-1.9" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>;

export type Sym = 'NEAR' | 'USD' | 'tUSD';
const NAMES: Record<Sym, string> = { NEAR: 'NEAR', USD: 'US dollar', tUSD: 'tUSD, test token with no value' };

/** One token logo. Sizes: 16 inline (tables, fields, rows), 20 vault sheet, 24 to 28 market bars. tUSD shows a "test" tag from 20 px up; below that its "tUSD" ticker is always written next to it. */
export function TokenLogo({ sym, size = 16, label }: { sym: Sym; size?: number; label?: boolean }) {
  const test = sym === 'tUSD';
  const a11y = label ? { role: 'img', 'aria-label': NAMES[sym] } : { 'aria-hidden': true as const };
  return <span className={`tok tok-${sym === 'NEAR' ? 'near' : 'usd'}${test ? ' tok-test' : ''}${size >= 20 ? ' tok-lg' : ''}`} style={{ width: size, height: size }} title={NAMES[sym]} {...a11y}>
    {sym === 'NEAR' ? <img src={NEAR_SRC} alt="" /> : <Dollar />}
    {test && <i>test</i>}
  </span>;
}

/** Base over quote, overlapping (NEAR / USD). */
export function PairLogo({ base, quote, size = 16 }: { base: Sym; quote: Sym; size?: number }) {
  return <span className="tpair" style={{ ['--s' as string]: `${size}px` }} aria-hidden="true"><TokenLogo sym={base} size={size} /><TokenLogo sym={quote} size={size} /></span>;
}

/** A logo in front of an amount or ticker, aligned on the text's centre line. */
export function WithLogo({ sym, size = 16, children }: { sym: Sym; size?: number; children: React.ReactNode }) {
  return <span className="tamt"><TokenLogo sym={sym} size={size} />{children}</span>;
}
