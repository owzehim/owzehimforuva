// LEG-05: earlier published versions of the legal documents, newest first.
// Texts live in src/content/legal-archive/<version>.json, rebuilt from the
// git commit that published them (sourceCommit), and load only when opened.
// Versions whose text was never committed are listed without a text.
export const LEGAL_ARCHIVE = [
  { version: '2026-11-06-04', available: true },
  { version: '2026-11-06-03', available: true },
  { version: '2026-11-06-02', available: true },
  { version: '2026-11-06-01', available: true },
  { version: '2026-11-05-01', available: true },
  { version: '2026-10-24-07', available: true },
  { version: '2026-10-24-06', available: false },
  { version: '2026-10-24-05', available: false },
  { version: '2026-10-07-02', available: true },
]

const loaders = import.meta.glob('./legal-archive/*.json')

export async function loadArchivedLegalVersion(version) {
  const load = loaders[`./legal-archive/${version}.json`]
  if (!load) return null
  const module = await load()
  return module.default ?? module
}
