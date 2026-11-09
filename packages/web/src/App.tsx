import { useEffect, useState } from 'react';
import Landing from './Landing';
import Console from './Console';
import OrderPage from './OrderPage';
import { Icon } from './ui';
import { useWallet } from './wallet';

function useRoute() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => { const on = () => setPath(location.pathname); addEventListener('popstate', on); return () => removeEventListener('popstate', on); }, []);
  return path;
}

export default function App() {
  const path = useRoute();
  const wallet = useWallet();
  const orderId = path.match(/^\/order\/(\d+)/)?.[1];
  const page = orderId ? 'order' : path.startsWith('/app') ? 'app' : 'home';
  useEffect(() => { document.title = page === 'home' ? 'Mienai · Your stop-loss is invisible until it fires' : page === 'app' ? 'Mienai · Console' : `Mienai · Order №${orderId}`; }, [page, orderId]);
  const banner = wallet.error && <p className="banner" role="alert">{wallet.error}<button onClick={() => wallet.setError('')} aria-label="Dismiss"><Icon name="x" size={14} /></button></p>;
  return <div className={page === 'home' ? 'site' : 'app'}>
    <a className="skip" href="#main">Skip to content</a>
    {banner}
    {page === 'home' ? <Landing /> : page === 'app' ? <Console wallet={wallet} /> : <OrderPage id={Number(orderId)} wallet={wallet} />}
  </div>;
}
