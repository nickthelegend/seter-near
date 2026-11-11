import { useEffect, useState } from 'react';
import Landing from './Landing';
import Terminal, { AppHeader } from './Terminal';
import OrderPage from './OrderPage';
import { Icon, Link, State } from './ui';
import { useWallet } from './wallet';

function useRoute() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => { const on = () => setPath(location.pathname); addEventListener('popstate', on); return () => removeEventListener('popstate', on); }, []);
  return path;
}

export default function App() {
  const path = useRoute();
  const wallet = useWallet();
  const match = path.match(/^\/order\/(\d+)\/?$/)?.[1];
  const orderId = match !== undefined && Number.isSafeInteger(Number(match)) ? Number(match) : null;
  const page = orderId !== null ? 'order' : /^\/app\/?$/.test(path) ? 'app' : path === '/' ? 'home' : 'missing';
  useEffect(() => { document.title = page === 'home' ? 'Seter · Your stop-loss is invisible until it fires' : page === 'app' ? 'Seter · Trade NEAR/USD' : page === 'order' ? `Seter · Order №${orderId}` : 'Seter · Page not found'; }, [page, orderId]);
  const banner = wallet.error && <p className="banner" role="alert">{wallet.error}<button onClick={() => wallet.setError('')} aria-label="Dismiss"><Icon name="x" size={14} /></button></p>;
  return <div className={page === 'home' ? 'site' : 'app'}>
    <a className="skip" href="#main">Skip to content</a>
    {banner}
    {page === 'home' ? <Landing /> : page === 'app' ? <Terminal wallet={wallet} /> : page === 'order' ? <OrderPage id={orderId!} wallet={wallet} />
      : <div className="term-page"><AppHeader wallet={wallet} /><main className="order" id="main"><State kind="empty" title="Page not found" action={<Link to="/app" className="btn btn-ghost btn-sm">Back to trading</Link>}>Check the address or return to trading.</State></main></div>}
  </div>;
}
