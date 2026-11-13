import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file) => readFileSync(file, 'utf8')

test('admin panel has no 로그아웃 button (log out from 설정)', () => {
  const admin = read('src/pages/AdminPage.jsx')
  assert.ok(!admin.includes('로그아웃'))
  assert.ok(!admin.includes('supabase.auth.signOut'))
  assert.ok(read('src/pages/SettingsPage.jsx').includes('로그아웃'))
})

test('toasts can be swiped away: top ones up, bottom (action) ones down', () => {
  const provider = read('src/components/feedback/FeedbackProvider.jsx')
  assert.match(provider, /const direction = edge === 'top' \? -1 : 1/)
  assert.match(provider, /onPointerDown=\{onPointerDown\}/)
  assert.match(provider, /edge="top" \/>/)
  assert.match(provider, /edge="bottom" \/>/)
  // The click that ends a drag must not count as a tap.
  assert.match(provider, /swallowClick\.current = true/)
})
