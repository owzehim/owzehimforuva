/** Prevent user-controlled text from being interpreted as a Sheets formula. */
export function sheetText(value, maxLength = 2000) {
  const text = String(value ?? '').slice(0, maxLength)
  return /^[\s\uFEFF]*[=+\-@]/u.test(text) ? `'${text}` : text
}
