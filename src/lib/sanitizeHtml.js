import DOMPurify from 'dompurify'

const RICH_TEXT_TAGS = [
  'a', 'b', 'blockquote', 'br', 'div', 'em', 'font', 'i', 'li', 'ol',
  'p', 'span', 'strong', 'u', 'ul',
]

const RICH_TEXT_ATTRIBUTES = ['href', 'color']

if (typeof window !== 'undefined' && typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (node.nodeName !== 'A' || data.attrName !== 'href') return

    try {
      const url = new URL(data.attrValue)
      if (url.protocol !== 'https:' || url.username || url.password) {
        data.keepAttr = false
        return
      }
      data.attrValue = url.href
    } catch {
      data.keepAttr = false
    }
  })
}

export function sanitizeRichText(value) {
  if (typeof value !== 'string' || value.length === 0) return ''

  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: RICH_TEXT_TAGS,
    ALLOWED_ATTR: RICH_TEXT_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_ATTR: ['style', 'srcset'],
  })
}

export function richTextToPlainText(value) {
  if (typeof value !== 'string' || value.length === 0) return ''

  const fragment = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  })

  return (fragment.textContent || '').replace(/\u00a0/g, ' ').trim()
}

export function getSafeHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

export function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/([,;])/g, '\\$1')
}
