// LEG-05: explicit acceptance wording and the archive of earlier versions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { legalDocuments, LEGAL_DOCUMENT_VERSION } from '../src/content/legalDocuments.js'

const archiveDir = 'src/content/legal-archive'
const indexSource = readFileSync('src/content/legalArchiveIndex.js', 'utf8')

test('no document says that continued use counts as acceptance', () => {
  for (const key of ['terms', 'privacy', 'community']) {
    const document = legalDocuments[key]
    assert.doesNotMatch(document.body, /continued use of the app[^.]*constitutes acceptance/i, key)
    assert.doesNotMatch(document.ko.body, /계속 이용하면[^.]*동의한 것으로 봅니다/, key)
  }
  assert.match(legalDocuments.terms.body, /ask you to accept them before you continue using the App/)
  assert.match(legalDocuments.terms.ko.body, /동의해야 계속 이용할 수 있습니다/)
  assert.match(legalDocuments.community.body, /ask you to accept them before you continue using the App/)
  assert.match(legalDocuments.community.ko.body, /동의해야 계속 이용할 수 있습니다/)
})

test('every archived file is a complete earlier version listed in the index', () => {
  const files = readdirSync(archiveDir).filter((name) => name.endsWith('.json'))
  assert.ok(files.length >= 4)
  for (const file of files) {
    const data = JSON.parse(readFileSync(`${archiveDir}/${file}`, 'utf8'))
    assert.equal(`${data.version}.json`, file)
    assert.notEqual(data.version, LEGAL_DOCUMENT_VERSION, 'the current version is not an archive entry')
    assert.match(data.sourceCommit, /^[0-9a-f]{7,40}$/)
    for (const key of ['terms', 'privacy', 'community']) {
      assert.ok(data.documents[key].body.length > 1000, `${file} ${key}`)
    }
    assert.ok(indexSource.includes(`{ version: '${data.version}', available: true }`), file)
  }
})

test('versions without a committed text are listed as not archived', () => {
  for (const version of ['2026-10-24-05', '2026-10-24-06']) {
    assert.ok(indexSource.includes(`{ version: '${version}', available: false }`), version)
  }
})
