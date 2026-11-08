// Side-effect module, imported second in main.jsx (right after the polyfills), so
// fetch / XHR / sendBeacon follow the chosen checker instance before any other
// module can make a checker call. See utils/checkerHost.js.
import { installCheckerRouting, ensureCheckerHost } from './utils/checkerHost';

installCheckerRouting();
// Not awaited: until the race resolves, calls use the stored pick or the primary.
ensureCheckerHost();
