/**
 * Lightweight HTML sanitizer for the renderer.
 * Allows a safe subset of tags/attributes — strips scripts, event handlers,
 * dangerous protocols, and unknown tags.
 *
 * Uses the browser's own DOMParser so no external dependency is needed.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'del',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span', 'hr',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a:   new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  td:  new Set(['colspan', 'rowspan']),
  th:  new Set(['colspan', 'rowspan']),
};

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    return SAFE_PROTOCOLS.has(u.protocol);
  } catch {
    return false;
  }
}

function cleanNode(node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.cloneNode(false);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tag)) {
    // Strip tag but keep its children
    const frag = document.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) {
      const cleaned = cleanNode(child);
      if (cleaned) frag.appendChild(cleaned);
    }
    return frag;
  }

  const newEl = document.createElement(tag);
  const allowedAttrs = ALLOWED_ATTRS[tag];

  if (allowedAttrs) {
    for (const attr of Array.from(el.attributes)) {
      if (!allowedAttrs.has(attr.name)) continue;
      const val = attr.value;
      // Validate URLs for href/src
      if ((attr.name === 'href' || attr.name === 'src') && !isSafeUrl(val)) continue;
      newEl.setAttribute(attr.name, val);
    }
    // Force links to open safely
    if (tag === 'a') {
      newEl.setAttribute('target', '_blank');
      newEl.setAttribute('rel', 'noopener noreferrer');
    }
  }

  for (const child of Array.from(el.childNodes)) {
    const cleaned = cleanNode(child);
    if (cleaned) newEl.appendChild(cleaned);
  }

  return newEl;
}

/**
 * Sanitize an HTML string and return a safe HTML string.
 * Safe to pass to `dangerouslySetInnerHTML`.
 */
export function sanitizeHtml(dirty: string): string {
  if (!dirty) return '';
  const doc = new DOMParser().parseFromString(dirty, 'text/html');
  const frag = document.createDocumentFragment();
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = cleanNode(child);
    if (cleaned) frag.appendChild(cleaned);
  }
  const tmp = document.createElement('div');
  tmp.appendChild(frag);
  return tmp.innerHTML;
}
