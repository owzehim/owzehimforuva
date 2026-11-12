// OPS-04: these tests render the real components and check the HTML a member
// would see, instead of searching the source files for a sentence.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderEntry } from './helpers/renderComponent.js'

const render = (body) => renderEntry(`
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
${body}
`)

test('LEG-02: the public page shows the not-affiliated line on screen', async () => {
  const html = await render(`
import PublicPage from 'src/pages/PublicPage.jsx'
export default () => renderToStaticMarkup(<MemoryRouter><PublicPage /></MemoryRouter>)
`)
  assert.match(html, /UvA-IN은 암스테르담 대학교\(UvA\)와 제휴를 맺지 않은 비공식 단체입니다/)
})

test('비밀번호 바꾸기: the message area comes after the 변경 완료 button and is out of the layout flow', async () => {
  const html = await render(`
import ChangePasswordPage from 'src/pages/ChangePasswordPage.jsx'
export default () => renderToStaticMarkup(<MemoryRouter><ChangePasswordPage /></MemoryRouter>)
`)
  const button = html.indexOf('settings-password-submit')
  const message = html.indexOf('settings-password-message')
  assert.ok(button > 0 && message > button, 'message is rendered after the button')
  assert.match(html, /class="settings-password-message absolute[^"]*top-full/)
})

test('GDPR-24: the admin stamp form tells admins the note is visible to the member', () => {
  // The add-stamp form opens only after a click, so this one stays a source check.
  assert.match(readFileSync('src/features/stampCard/components/StampCardMemberPanel.jsx', 'utf8'), /사유 \(선택 · 회원에게도 보여요\)/)
})
