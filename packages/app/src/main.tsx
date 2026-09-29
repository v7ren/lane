import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import TerminalApp from './TerminalApp';
import './styles/index.css';

const params = new URLSearchParams(window.location.search);
const isTerminalApp = params.has('terminal') || params.has('cmd') || window.location.hash === '#terminal';

void (async () => {
  const Root = isTerminalApp ? TerminalApp : App;
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
})();
