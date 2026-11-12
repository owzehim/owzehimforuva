// OPS-04: render a real component to HTML, so a test fails when text is not
// actually on screen (a source-text search passed for LEG-02 while the line was
// in an unused component). The component is bundled with rolldown (comes with
// Vite); React stays external so the test and the component share one copy.
// Supabase and browser-only modules are replaced by small stubs.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rolldown } from 'rolldown'

const STUBS = resolve('tests/helpers/stubs')
const CACHE = resolve('node_modules/.cache/ops04-render')

/**
 * Bundle `entrySource` (an ES module that default-exports a function returning
 * HTML) and run it. `entrySource` may import from 'src/...'.
 * @param {string} entrySource
 * @returns {Promise<string>}
 */
export async function renderEntry(entrySource) {
  // Inside the repo, so the bundle finds react / react-dom in node_modules.
  mkdirSync(CACHE, { recursive: true })
  const dir = mkdtempSync(join(CACHE, 'render-'))
  try {
    const entry = join(dir, 'entry.jsx')
    writeFileSync(entry, entrySource.replaceAll("from 'src/", `from '${resolve('src')}/`))
    const bundle = await rolldown({
      input: entry,
      platform: 'node',
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^react-router(-dom)?$/],
      resolve: {
        alias: {
          [resolve('src/lib/supabase.js')]: join(STUBS, 'supabase.js'),
          [resolve('src/lib/supabase')]: join(STUBS, 'supabase.js'),
        },
      },
      transform: {
        define: {
          'import.meta.env': JSON.stringify({
            DEV: false, PROD: true, MODE: 'test', BASE_URL: '/',
            VITE_SUPABASE_URL: 'http://localhost:54321',
            VITE_SUPABASE_PUBLISHABLE_KEY: 'test-key',
          }),
        },
      },
      plugins: [{
        name: 'stub-modules',
        resolveId(source) {
          if (/(^|\/)lib\/supabase(\.js)?$/.test(source)) return join(STUBS, 'supabase.js')
          if (/(^|\/)lib\/passwordRecoverySupabase(\.js)?$/.test(source)) return join(STUBS, 'supabase.js')
          // Browser-only pieces (map with WebGL + worker, Turnstile widget) render nothing in tests.
          if (/(^|\/)components\/MapView(\.jsx)?$/.test(source)) return join(STUBS, 'NullComponent.jsx')
          if (/(^|\/)components\/CaptchaChallenge(\.jsx)?$/.test(source)) return join(STUBS, 'NullComponent.jsx')
          if (source.includes('?')) return join(STUBS, 'empty.js')
          if (/\.(css|png|jpe?g|webp|svg)$/.test(source)) return join(STUBS, 'empty.js')
          return null
        },
      }],
      logLevel: 'silent',
    })
    const out = join(dir, 'out.mjs')
    await bundle.write({ file: out, format: 'esm', codeSplitting: false })
    await bundle.close()
    const mod = await import(pathToFileURL(out).href)
    return await mod.default()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
