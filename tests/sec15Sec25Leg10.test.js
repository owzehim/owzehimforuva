import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('SEC-15: an already registered new address gets the normal success response', async () => {
  const source = await readFile('supabase/functions/change-pending-email/index.ts', 'utf8')
  const takenBranch = source.indexOf('isEmailTakenError(createError)')
  assert.ok(takenBranch > 0)
  assert.ok(source.slice(takenBranch, takenBranch + 400).includes('return json(successResponse)'))
  assert.ok(takenBranch < source.indexOf("console.warn('Pending email replacement could not be created')"))
})

test('SEC-25: an older login cannot take the device seat back', async () => {
  const source = await readFile('supabase/migrations/20261109120000_sec25_newest_login_keeps_device.sql', 'utf8')
  assert.match(source, /FOR UPDATE/)
  assert.match(source, /seat_login_at >= caller_login_at THEN\s+RETURN false/)
  assert.match(source, /FROM auth\.sessions AS session/)
})

test('LEG-10: the installed app is not locked to portrait', async () => {
  const source = await readFile('vite.config.js', 'utf8')
  assert.ok(!source.includes("orientation: 'portrait'"))
})

test('SEC-26/PERF-10/SEC-20: legacy admin policies dropped, policy calls wrapped, unused grants revoked', async () => {
  const source = await readFile('supabase/migrations/20261110090000_sec26_perf10_sec20_sec25_admin_cleanup.sql', 'utf8')
  for (const name of ['관리자 멤버 삭제', '관리자 식당 삭제', '관리자 식당 수정', '관리자 식당 추가', '관리자 이벤트 삭제', '관리자 이벤트 수정', '관리자 이벤트 추가']) {
    assert.ok(source.includes(`DROP POLICY IF EXISTS "${name}"`), name)
  }
  const alterSection = source.slice(source.indexOf('-- 2. PERF-10 ---'), source.indexOf('-- 3. SEC-20 ---'))
  assert.ok(!/[^.]is_admin\(\)/.test(alterSection.replaceAll('public.is_admin()', '')))
  assert.match(source, /REVOKE SELECT, INSERT, UPDATE, DELETE ON public\.privacy_action_log FROM authenticated/)
  const check = await readFile('supabase/checks/permission-check.sql', 'utf8')
  assert.ok(!check.includes('privacy_action_log'))
})

test('FUNC-01: the migration that deletes the Master Sheet address is archived', async () => {
  const { readdir } = await import('node:fs/promises')
  assert.ok(!(await readdir('supabase/migrations')).some((file) => file.startsWith('20261011110000')))
})

test('LEG-07: the collapsed SpotCard shows the 할인 제공 / 유료 광고 label', async () => {
  const source = await readFile('src/components/SpotCard.jsx', 'utf8')
  assert.match(source, /getRestaurantCommercialLabel\(commercialLabelType\)/)
  // Outside the sheet, above its top-left corner, in the map marker's badge style.
  assert.match(source, /spot-card-label-anchor/)
  assert.match(source, /bottom: 'calc\(100% \+ 6px\)'/)
  assert.match(source, /getCommercialLabelStyle\(commercialLabelType, darkMode\)/)
  const mapView = await readFile('src/components/MapView.jsx', 'utf8')
  assert.match(mapView, /getCommercialLabelStyle\(commercialLabelType, dark\)/)
})

test('SpotCard: Google Maps button slides with the sheet and keeps its place between markers', async () => {
  const source = await readFile('src/components/SpotCard.jsx', 'utf8')
  assert.match(source, /'transform 0\.35s cubic-bezier\(0\.4,0,0\.2,1\), opacity 0\.2s ease'/)
  const effect = source.slice(source.indexOf('// Keep the current position while another marker'), source.indexOf('const scheduleMeasure'))
  assert.ok(!effect.includes('setGoogleMapsButtonCenterY(null)\n    let'), 'must not reset before measuring')
})

test('PERF-09: the map stays mounted when another tab is shown', async () => {
  const source = await readFile('src/pages/MemberPage.jsx', 'utf8')
  assert.ok(!source.includes("hasOpenedMap && activeTab === 'map' &&"))
  assert.match(source, /display: activeTab === 'map' \? 'block' : 'none'/)
})

test('SEC-11: calendar export escapes title and location', async () => {
  const source = await readFile('src/pages/MemberPage.jsx', 'utf8')
  assert.match(source, /SUMMARY:\$\{escapeIcsText\(/)
  assert.match(source, /LOCATION:\$\{escapeIcsText\(/)
})

test('SEC-59: the reset page shows which account the link resets', async () => {
  const source = await readFile('src/pages/ResetPasswordPage.jsx', 'utf8')
  assert.match(source, /passwordRecoverySupabase\.auth\.getUser\(\)/)
  assert.match(source, /reset-password-account/)
  assert.match(source, /내 이메일이 아니라면 비밀번호를 바꾸지 말고 이 화면을 닫아 주세요\./)
})
