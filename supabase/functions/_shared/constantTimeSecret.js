const SECRET_MIN_BYTES = 32
const SECRET_MAX_BYTES = 512
const SHA256_BYTES = 32

function fixedDigestInput(secretBytes) {
  const input = new Uint8Array(SECRET_MAX_BYTES + 2)
  input[0] = secretBytes.length >> 8
  input[1] = secretBytes.length & 0xff
  input.set(secretBytes, 2)
  return input
}

export async function constantTimeSecretEquals(expected, supplied) {
  if (typeof expected !== 'string' || typeof supplied !== 'string') return false

  const encoder = new TextEncoder()
  const expectedBytes = encoder.encode(expected)
  const suppliedBytes = encoder.encode(supplied)
  if (
    expectedBytes.length < SECRET_MIN_BYTES
    || expectedBytes.length > SECRET_MAX_BYTES
    || suppliedBytes.length > SECRET_MAX_BYTES
  ) {
    return false
  }

  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', fixedDigestInput(expectedBytes)),
    crypto.subtle.digest('SHA-256', fixedDigestInput(suppliedBytes)),
  ])
  const expectedHash = new Uint8Array(expectedDigest)
  const suppliedHash = new Uint8Array(suppliedDigest)

  let difference = 0
  for (let index = 0; index < SHA256_BYTES; index += 1) {
    difference |= expectedHash[index] ^ suppliedHash[index]
  }
  return difference === 0
}
