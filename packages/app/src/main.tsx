import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import TerminalApp from './TerminalApp';
import { DemoProvider } from './lib/demo/DemoContext';
import { parseDemoVariant } from './lib/demo-mode';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './styles/index.css';

const params = new URLSearchParams(window.location.search);
const isTerminalApp = params.has('terminal') || params.has('cmd') || window.location.hash === '#terminal';
const demoVariant = parseDemoVariant();

void (async () => {
  const Root = isTerminalApp ? TerminalApp : App;
  const app = demoVariant ? (
    <DemoProvider variant={demoVariant}>
      <Root />
    </DemoProvider>
  ) : (
    <Root />
  );
  ReactDOM.createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
})();
