// Small DOM helpers shared by every module.
export function qs(id) {
    return document.getElementById(id);
}

export function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
}

export function setText(id, text) {
    const el = qs(id);
    if (el) el.textContent = text;
}

export function toggleClass(id, className, on) {
    const el = qs(id);
    if (el) el.classList.toggle(className, !!on);
}

/** Escape a value for interpolation into an HTML template. */
export function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

/**
 * Delegated listener: run `handler(event, matchedElement)` when a click lands
 * on (or inside) an element matching `selector`.
 */
export function delegate(root, eventName, selector, handler) {
    if (!root) return () => {};
    const listener = (event) => {
        const target = event.target.closest(selector);
        if (target && root.contains(target)) handler(event, target);
    };
    root.addEventListener(eventName, listener);
    return () => root.removeEventListener(eventName, listener);
}
