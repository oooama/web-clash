// JSON API client.
//
// Every mutating request carries X-Console-Request: the console rejects
// state-changing requests without it, which is what makes a cross-site POST
// impossible (a cross-origin request cannot set a custom header without a
// preflight, and the server never answers one).
//
// Reads are additionally cancellable: the router registers the signal for the
// page that is currently mounted, so navigating away aborts any in-flight GET.
// Mutations are never aborted - a click on "Apply" must complete even if the
// user navigates immediately afterwards.
import { emit } from './store.js';

const CONSOLE_HEADER = { 'Content-Type': 'application/json', 'X-Console-Request': '1' };

let activeSignal = null;

/** Point the read-cancellation signal at the page that is now mounted. */
export function setActiveSignal(signal) {
    activeSignal = signal || null;
}

/**
 * Request JSON from the console.
 *
 * GETs carry the signal of the page that is currently mounted, so navigating
 * away cancels a read that is no longer wanted. Mutations deliberately omit it:
 * clicking "Apply" must complete even if the user navigates straight after.
 * Cancellation resolves to null, exactly like any other failure, so callers
 * keep their existing null checks.
 */
export async function api(p,o={}){try{const r=await fetch('/api'+p,{headers:CONSOLE_HEADER,...o,signal:(!o.method||o.method==='GET')?activeSignal:undefined,body:o.body?JSON.stringify(o.body):undefined});return await r.json();}catch{return null;}}

export { CONSOLE_HEADER };
