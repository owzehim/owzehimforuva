// LEG-05: earlier published versions of the legal documents, newest first.
// Texts live in src/content/legal-archive/<version>.json and load only when
// opened. The pre-launch drafts were removed on 2026-11-07; 2026-11-07-01 is
// the first launch version. When a later version replaces the current one,
// save the replaced version's full text as <version>.json (with the commit it
// was published from as sourceCommit) and list it here.
// The "Earlier versions" button on the legal page appears once this list has
// an entry.
export const LEGAL_ARCHIVE = [
  { version: '2026-11-07-01', available: true },
]

const loaders = import.meta.glob('./legal-archive/*.json')

export async function loadArchivedLegalVersion(version) {
  const load = loaders[`./legal-archive/${version}.json`]
  if (!load) return null
  const module = await load()
  return module.default ?? module
}
