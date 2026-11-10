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
  assert.match(source, /bottom: 'calc\(100% \+ 8px\)'/)
  assert.match(source, /getCommercialLabelStyle\(commercialLabelType, darkMode, 'card'\)/)
  const mapView = await readFile('src/components/MapView.jsx', 'utf8')
  assert.match(mapView, /getCommercialLabelStyle\(commercialLabelType, dark\)/)
})

test('SpotCard: Google Maps button slides with the sheet and keeps its place between markers', async () => {
  const source = await readFile('src/components/SpotCard.jsx', 'utf8')
  assert.match(source, /'transform 0\.35s cubic-bezier\(0\.4,0,0\.2,1\), opacity 0\.2s ease, top 0\.25s ease'/)
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

test('SEC-15: sign-up answers an already registered address like a new one', async () => {
  const source = await readFile('src/api/memberRepository.js', 'utf8')
  const body = source.slice(source.indexOf('export async function registerMember'))
  assert.ok(!body.includes('throw new Error(ALREADY_REGISTERED_MESSAGE)'))
  assert.equal((body.match(/return \{ userId: null \}/g) || []).length, 2)
  const page = await readFile('src/pages/RegistrationPage.jsx', 'utf8')
  assert.match(page, /이미 가입된 주소라면 메일이 발송되지 않습니다/)
})

test('No browser alert()/confirm() popups; the in-app feedback components are used instead', async () => {
  const { readdir } = await import('node:fs/promises')
  const files = []
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) await walk(full)
      else if (/\.(jsx?|tsx?)$/.test(entry.name)) files.push(full)
    }
  }
  await walk('src')
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const code = source.replace(/\/\/.*$/gm, '')
    // Browser popups: alert(...), window.confirm(...), or confirm('text').
    assert.ok(!/(^|[^.\w])(window\.)?alert\(|window\.confirm\(|(^|[^.\w])confirm\(\s*['"`]/m.test(code), file)
  }
  const eslint = await readFile('eslint.config.js', 'utf8')
  assert.match(eslint, /'no-alert': 'error'/)
  const main = await readFile('src/main.jsx', 'utf8')
  assert.match(main, /<FeedbackProvider>/)
})

test('SpotCard: compact cards reuse the tall card button position (no jump between markers)', async () => {
  const source = await readFile('src/components/SpotCard.jsx', 'utf8')
  assert.match(source, /let rememberedButtonAnchor = /)
  assert.match(source, /rememberButtonAnchor\(nextCenter\)/)
  assert.match(source, /top: `\$\{buttonAnchorY\}px`/)
})

test('Commercial label: card size is larger than the marker badge', async () => {
  const { getCommercialLabelStyle } = await import('../src/lib/restaurantCommercialLabel.js')
  const marker = getCommercialLabelStyle('paid_ad', false)
  const card = getCommercialLabelStyle('paid_ad', false, 'card')
  assert.equal(marker.fontSize, '8px')
  assert.ok(parseInt(card.fontSize, 10) > parseInt(marker.fontSize, 10))
  assert.equal(card.background, marker.background)
})

test('Admin: sticky header and tabs; 수정 opens in a popup', async () => {
  const source = await readFile('src/pages/AdminPage.jsx', 'utf8')
  assert.match(source, /admin-sticky-header sticky top-0/)
  assert.match(source, /overflow-x-clip/)
  for (const label of ['멤버 수정', '이벤트 수정', '장소 수정']) assert.match(source, new RegExp(`<EditPopup label="${label}"`))
  const popup = await readFile('src/components/EditPopup.jsx', 'utf8')
  assert.match(popup, /onCloseRef\.current\(\)/, 'Esc closes without re-running the effect on each render')
  assert.match(popup, /transform: shown \? undefined/, 'no transform at rest (keeps fixed children on screen)')
})

test('SpotCard switching: no entrance replay, content crossfade, button frozen while open', async () => {
  const source = await readFile('src/components/SpotCard.jsx', 'utf8')
  assert.match(source, /function SpotCardSheet\(/)
  assert.match(source, /contentVisible=\{!switching\}/)
  const effect = source.slice(source.indexOf('// Another marker while the card is open'), source.indexOf('// Updating the selected record'))
  assert.ok(effect.includes('return') && !effect.includes('setIsVisible(false)'), 'switching must not hide and re-show the sheet')
  assert.match(source, /sessionAnchorRef/)
  assert.match(source, /uvain:spot-card-button-anchor/)
})

test('Admin page is sized to the visible screen (no scroll when not needed)', async () => {
  const source = await readFile('src/pages/AdminPage.jsx', 'utf8')
  assert.match(source, /min-h-\[100dvh\] bg-gray-50 overflow-x-clip/)
  assert.ok(!source.includes('min-h-screen bg-gray-50'))
})
