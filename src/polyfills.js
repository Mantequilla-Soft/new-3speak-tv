// // This file MUST be imported first in main.jsx
// // It sets up Buffer globally before any other modules load
// import { Buffer } from 'buffer';

// // Set Buffer globally
// globalThis.Buffer = Buffer;
// window.Buffer = Buffer;

// // Also ensure process is available
// if (typeof globalThis.process === 'undefined') {
//   globalThis.process = { env: {} };
// }


import { Buffer } from 'buffer';
import process from 'process';

// Aggressively set Buffer globally
window.Buffer = Buffer;
globalThis.Buffer = Buffer;
global.Buffer = Buffer;

// Set process
window.process = process;
globalThis.process = process;

// Set global
window.global = window;
globalThis.global = globalThis;

console.log('✅ Polyfills loaded - Buffer available:', typeof Buffer !== 'undefined');

export { Buffer, process };