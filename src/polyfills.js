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

// console.log('✅ Polyfills loaded - Buffer available:', typeof Buffer !== 'undefined');

export { Buffer, process };
