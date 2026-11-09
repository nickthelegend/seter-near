import { useEffect, useState } from 'react';
import Landing from './Landing';
import AppPage from './AppPage';

export default function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = (to: string) => { history.pushState(null, '', to); setPath(to); window.scrollTo(0, 0); };
  return path.startsWith('/app') ? <AppPage go={go} /> : <Landing go={go} />;
}
