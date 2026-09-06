const PASTEL_COLORS = [
  '#FFB3B3',
  '#FFD9A0',
  '#FFF3A0',
  '#B3F0C2',
  '#A8D8FF',
  '#C5B3FF',
  '#FFB3E6',
  '#B3F0EE',
]

export function getPastelColor(seed) {
  const str = seed || 'default'
  let hash = 0
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) | 0
  return PASTEL_COLORS[Math.abs(hash) % PASTEL_COLORS.length]
}

export function getMemberAvatarSeed(member) {
  return `${member?.first_name || ''}${member?.last_name || ''}`
}
