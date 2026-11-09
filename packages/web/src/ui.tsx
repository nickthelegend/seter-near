import type { ReactNode } from 'react';
import { txUrl } from './lib';

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <a className={`logo${small ? ' logo--small' : ''}`} href="/" aria-label="Mienai home">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 3l10 4.2v7.3c0 6.6-4.2 11.6-10 14.5C10.2 26.1 6 21.1 6 14.5V7.2z" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3 16.5h26" stroke="var(--signal)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className="logo__word">Mienai</span>
      <span className="logo__kanji" lang="ja">見えない</span>
    </a>
  );
}

/** A number with its trailing digits dimmed, so the significant part reads first. */
export function Num({ value, bright = 2, unit }: { value: string; bright?: number; unit?: string }) {
  const [int, frac = ''] = value.split('.');
  return (
    <span className="num">
      {int}{frac && <>.<span>{frac.slice(0, bright)}</span><span className="num__dim">{frac.slice(bright)}</span></>}
      {unit && <span className="num__unit"> {unit}</span>}
    </span>
  );
}

export function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'signal' | 'accent' | 'danger' | 'warn'; children: ReactNode }) {
  return <span className={`chip chip--${tone}`}><i aria-hidden="true" />{children}</span>;
}

export const statusTone = (s: string) => (s === 'Fired' ? 'signal' : s === 'Open' ? 'accent' : s === 'Unfilled' ? 'warn' : 'neutral') as 'signal' | 'accent' | 'warn' | 'neutral';

/** A redaction bar standing in for a value that is sealed on chain. */
export function Redacted({ label = 'sealed', width = 7 }: { label?: string; width?: number }) {
  return <span className="redacted" style={{ width: `${width}ch` }} title="Encrypted to the enclave; not on chain in plaintext"><span>{label}</span></span>;
}

export function Tx({ hash, label }: { hash: string; label?: string }) {
  return <a className="tx" href={txUrl(hash)} target="_blank" rel="noreferrer">{label ?? `${hash.slice(0, 6)}…${hash.slice(-4)}`}<span aria-hidden="true"> ↗</span></a>;
}

export function State({ kind, children }: { kind: 'loading' | 'empty' | 'error' | 'setup'; children: ReactNode }) {
  return <div className={`state state--${kind}`} role={kind === 'error' ? 'alert' : undefined}><span className="state__dot" aria-hidden="true" />{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) { return <p className="eyebrow">{children}</p>; }

export function Ciphertext({ value, chars = 64 }: { value: string; chars?: number }) {
  return <code className="cipher" title={value}>{value.slice(0, chars)}<span className="cipher__fade">{value.slice(chars, chars + 24)}</span></code>;
}
