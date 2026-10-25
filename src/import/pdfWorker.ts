/**
 * The pdfjs worker, wrapped so the polyfill is installed inside the worker too —
 * pdf.worker.min.mjs uses Promise.withResolvers just as the main bundle does.
 * Loaded via `new Worker(new URL('./pdfWorker.ts', import.meta.url))` in pdf.ts.
 */
import './promiseWithResolvers';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
