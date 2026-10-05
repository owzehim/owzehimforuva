export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the configured limit')
    this.name = 'RequestBodyTooLargeError'
  }
}

export class InvalidRequestBodyError extends Error {
  constructor(message = 'Request body must contain valid JSON') {
    super(message)
    this.name = 'InvalidRequestBodyError'
  }
}

/** Read and parse JSON while enforcing a byte limit even without Content-Length. */
export async function readJsonBody(request, maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError('maximumBytes must be a positive safe integer')
  }

  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      throw new InvalidRequestBodyError('Invalid Content-Length')
    }
    if (declaredBytes > maximumBytes) throw new RequestBodyTooLargeError()
  }

  if (!request.body) throw new InvalidRequestBodyError()

  const reader = request.body.getReader()
  const chunks = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    totalBytes += value.byteLength
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => {})
      throw new RequestBodyTooLargeError()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new InvalidRequestBodyError()
  }
}
