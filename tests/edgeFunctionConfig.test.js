import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')

test('sync-review-to-sheets deploys its review-sync entrypoint', () => {
  const functionBlock = config.match(
    /\[functions\.sync-review-to-sheets\]([\s\S]*?)(?=\n\[|$)/,
  )?.[1]

  assert.ok(functionBlock, 'sync-review-to-sheets must be configured')
  assert.match(functionBlock, /enabled\s*=\s*true/)
  assert.match(functionBlock, /verify_jwt\s*=\s*true/)
  assert.match(
    functionBlock,
    /entrypoint\s*=\s*"\.\/functions\/sync-review-to-sheets\/index\.ts"/,
  )
})

test('pending email finalization requires a JWT-authenticated Edge Function', () => {
  const functionBlock = config.match(
    /\[functions\.finalize-pending-email\]([\s\S]*?)(?=\n\[|$)/,
  )?.[1]

  assert.ok(functionBlock, 'finalize-pending-email must be configured')
  assert.match(functionBlock, /enabled\s*=\s*true/)
  assert.match(functionBlock, /verify_jwt\s*=\s*true/)
  assert.match(
    functionBlock,
    /entrypoint\s*=\s*"\.\/functions\/finalize-pending-email\/index\.ts"/,
  )
})

test('every enabled Edge Function has an existing entrypoint', () => {
  const sections = new Map()
  let currentFunction = null

  for (const line of config.split(/\r?\n/)) {
    const section = line.match(/^\[functions\.([^\]]+)\]$/)
    if (section) {
      currentFunction = section[1]
      sections.set(currentFunction, [])
    } else if (currentFunction) {
      sections.get(currentFunction).push(line)
    }
  }

  for (const [name, lines] of sections) {
    const block = lines.join('\n')
    if (!/^enabled\s*=\s*true$/m.test(block)) continue

    const configuredEntrypoint = block.match(/^entrypoint\s*=\s*"([^"]+)"$/m)?.[1]
    const entrypoint = configuredEntrypoint || `./functions/${name}/index.ts`
    const path = new URL(`../supabase/${entrypoint}`, import.meta.url)
    assert.ok(existsSync(path), `${name} entrypoint does not exist: ${entrypoint}`)
  }
})
