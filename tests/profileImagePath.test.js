import assert from 'node:assert/strict'
import test from 'node:test'
import { getProfileImagePath } from '../src/lib/profileImagePath.js'

const path = 'avatars/650ff94b-310a-4b5b-9dbf-545bba1a3b82.jpg'

test('profile image helper supports stored paths and legacy public/signed URLs', () => {
  assert.equal(getProfileImagePath(path), path)
  assert.equal(getProfileImagePath(`https://project.supabase.co/storage/v1/object/public/profile-images/${path}`), path)
  assert.equal(getProfileImagePath(`https://project.supabase.co/storage/v1/object/sign/profile-images/${path}?token=redacted`), path)
})

test('profile image helper rejects external URLs and paths outside avatars', () => {
  assert.equal(getProfileImagePath('https://attacker.example/avatars/pixel.jpg'), null)
  assert.equal(getProfileImagePath('events/pixel.jpg'), null)
  assert.equal(getProfileImagePath(''), null)
})

test('profile image helper rejects encoded traversal paths', () => {
  assert.equal(getProfileImagePath('avatars/%2e%2e/other-user.jpg'), null)
  assert.equal(getProfileImagePath('https://project.supabase.co/storage/v1/object/public/profile-images/avatars/%2e%2e/other-user.jpg'), null)
})
