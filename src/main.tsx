import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.tsx';
import './styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root is missing from index.html');

if (!globalThis.location.hash) globalThis.location.hash = '#/';

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Offline support, registered after first paint so it never blocks rendering.
 *
 * Every line here is inside a try/catch on purpose. In a sandboxed iframe
 * without `allow-same-origin` the browser gives the page an opaque origin, and
 * merely *reading* `navigator.serviceWorker` throws a SecurityError. An
 * uncaught throw at module scope blanks the entire app, which is exactly the
 * bug this guard exists to prevent. Offline support is an enhancement; losing
 * it must never cost the app.
 */
function registerServiceWorker(): void {
  try {
    if (!globalThis.location.protocol.startsWith('http')) return;
    if (!navigator.serviceWorker) return;
    void navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch {
    // Sandboxed, private mode, or otherwise unavailable. The app is unaffected.
  }
}

try {
  globalThis.addEventListener('load', registerServiceWorker);
} catch {
  /* no-op */
}
