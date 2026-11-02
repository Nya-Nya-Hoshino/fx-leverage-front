import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { connectWs, loadMeta, loadState } from './api';
import { initTheme } from './theme';

initTheme();

connectWs();
void loadMeta().then(loadState).catch(() => undefined);
createRoot(document.getElementById('root')!).render(<App />);
