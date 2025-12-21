// This file MUST be imported first in main.jsx
// It sets up Buffer globally before any other modules load
import { Buffer } from 'buffer';

// Set Buffer globally
globalThis.Buffer = Buffer;
window.Buffer = Buffer;

// Also ensure process is available
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {} };
}
