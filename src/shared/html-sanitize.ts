export function sanitizeHtml(html: string): string {
  if (typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      const allowedTags = new Set([
        'p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'blockquote', 'a', 'span', 'b', 'i', 'div'
      ]);
      const allowedAttrs = new Set(['href', 'target', 'title', 'class', 'style']);
      
      const cleanNode = (node: Node): Node | null => {
        if (node.nodeType === Node.TEXT_NODE) {
          return document.createTextNode(node.nodeValue || '');
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          const tagName = el.tagName.toLowerCase();
          
          if (!allowedTags.has(tagName)) {
            const frag = document.createDocumentFragment();
            for (let i = 0; i < el.childNodes.length; i++) {
              const child = cleanNode(el.childNodes[i]);
              if (child) frag.appendChild(child);
            }
            return frag;
          }
          
          const cleanEl = document.createElement(tagName);
          for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            const name = attr.name.toLowerCase();
            if (allowedAttrs.has(name)) {
              if (name === 'href') {
                const val = attr.value.trim().toLowerCase();
                if (/^(javascript|data|vbscript|blob):/i.test(val)) {
                  continue;
                }
              }
              cleanEl.setAttribute(attr.name, attr.value);
            }
          }
          
          for (let i = 0; i < el.childNodes.length; i++) {
            const child = cleanNode(el.childNodes[i]);
            if (child) cleanEl.appendChild(child);
          }
          
          return cleanEl;
        }
        return null;
      };
      
      const cleanFrag = document.createDocumentFragment();
      for (let i = 0; i < doc.body.childNodes.length; i++) {
        const child = cleanNode(doc.body.childNodes[i]);
        if (child) cleanFrag.appendChild(child);
      }
      
      const temp = document.createElement('div');
      temp.appendChild(cleanFrag);
      return temp.innerHTML;
    } catch {
      // Fall through
    }
  }
  
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?<\/embed>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(javascript|data|vbscript|blob)\s*:/gi, '');
}
