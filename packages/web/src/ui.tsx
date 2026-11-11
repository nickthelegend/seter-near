import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { txUrl } from './lib';

/* ---------- routing ---------- */
export function navigate(path: string) {
  if (location.pathname + location.hash === path) return;
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
  const hash = path.split('#')[1];
  if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  else scrollTo({ top: 0 });
}
export function Link({ to, className, children, ...rest }: { to: string; className?: string; children: ReactNode; 'aria-label'?: string; 'aria-current'?: 'page' | undefined }) {
  const onClick = (e: MouseEvent) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(to); };
  return <a href={to} className={className} onClick={onClick} {...rest}>{children}</a>;
}

/* ---------- icons ---------- */
const paths: Record<string, string> = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  seal: 'M12 3l2.4 1.6 2.9-.2 1 2.7 2.4 1.6-.6 2.8.9 2.8-2.3 1.7-.9 2.8-2.9.1L12 21l-2.4-1.6-2.9.1-.9-2.8L3.5 15l.9-2.8-.6-2.8 2.4-1.6 1-2.7 2.9.2zM8.5 12l2.4 2.4 4.6-4.8',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  plus: 'M12 5v14M5 12h14',
  wallet: 'M4 7a2 2 0 0 1 2-2h12v4M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2zM16 14h.01',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  log: 'M4 6h16M4 12h10M4 18h13',
  ticket: 'M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v8a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2zM15 6v12',
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

/* ---------- brand ---------- */
export function Mark({ size = 30 }: { size?: number }) {
  return <img className="mark" src="/art/seter-mark.webp" width={size} height={size} alt="" aria-hidden="true" />;
}
export function Wordmark({ small = false }: { small?: boolean }) {
  return <span className={`wordmark${small ? ' wordmark--sm' : ''}`}><Mark size={small ? 24 : 30} /><b>Seter</b></span>;
}

/* ---------- numbers and values ---------- */
/** A number with its trailing digits dimmed, so the significant part reads first. */
export function Num({ value, bright = 2, unit }: { value: string; bright?: number; unit?: string }) {
  const [int, frac = ''] = value.split('.');
  return <span className="num">{int}{frac && <>.<span>{frac.slice(0, bright)}</span><span className="num-dim">{frac.slice(bright)}</span></>}{unit && <small> {unit}</small>}</span>;
}
/** A striped bar standing in for a value that is sealed on chain. */
export function Redacted({ size = 'md', label = 'sealed' }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  return <span className={`redact redact-${size}`} title="Encrypted to the enclave; not on chain in plaintext"><span>{label}</span></span>;
}
export function Tx({ hash, label }: { hash: string; label?: string }) {
  return <a className="tx" href={txUrl(hash)} target="_blank" rel="noreferrer">{label ?? `${hash.slice(0, 6)}…${hash.slice(-4)}`}<Icon name="external" size={12} /></a>;
}
export function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    setFailed(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch { setFailed(true); }
  }
  const message = 'Copy is unavailable. Select the value and copy it manually.';
  return <button className="copy" onClick={copy} title={failed ? message : `Copy ${label}`} aria-label={`Copy ${label}`}>{done ? <Icon name="check" size={14} /> : <Icon name="copy" size={14} />}{failed && <span className="sr" role="status">{message}</span>}</button>;
}
export const shortHex = (h: string, a = 10, b = 6) => (h.length > a + b + 1 ? `${h.slice(0, a)}…${h.slice(-b)}` : h);

/* ---------- 3D objects (public/art/3d, frosted violet glass; see docs/ART-3D.md) ---------- */
const OBJ_ALT = {
  badge: 'Glass medal badge with a processor chip',
  bell: 'Glass alarm bell ringing',
  'candle-hidden': 'Glass candlestick with its level veiled',
  certificate: 'Glass certificate with a seal',
  coin: 'Glass coin sealed in a glass capsule',
  'envelope-lock': 'Glass envelope sealed with a padlock',
  'eye-slash': 'Glass eye with a slash through it',
  lock: 'Glass padlock',
  'shield-price': 'Glass shield in front of a price line',
  success: 'Glass token with a check mark',
  'tray-empty': 'Empty glass order tray',
  warning: 'Glass warning sign',
} as const;
export type ObjName = keyof typeof OBJ_ALT;
/** One frosted-glass 3D object, fixed size so nothing shifts; it floats gently unless reduced motion is on. */
export function Obj({ name, size, className, float = true }: { name: ObjName; size: number; className?: string; float?: boolean }) {
  return <img className={`obj${float ? ' obj-float' : ''}${className ? ` ${className}` : ''}`} src={`/art/3d/seter-3d-${name}.webp`} width={size} height={size} alt={OBJ_ALT[name]} decoding="async" />;
}

export function State({ kind, title, children, action, art }: { kind: 'loading' | 'empty' | 'error' | 'setup'; title: string; children?: ReactNode; action?: ReactNode; art?: ObjName }) {
  return <div className={`state state-${kind}${art ? ' state-art' : ''}`} role={kind === 'error' ? 'alert' : 'status'}>
    {art ? <Obj name={art} size={72} className="state-obj" /> : <span className="state-mark" aria-hidden="true">{kind === 'loading' ? <i className="pulse" /> : kind === 'error' ? '!' : kind === 'setup' ? <Icon name="lock" size={16} /> : <Icon name="eye" size={16} />}</span>}
    <div><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>
  </div>;
}

/* ---------- sheet ---------- */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  return <div className="sheet-wrap" onClick={onClose}>
    <aside className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>{children}</aside>
  </div>;
}
