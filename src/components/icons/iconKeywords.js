// Korean (and a few English) search words for the admin icon picker.
// Icon names themselves are searched too, so any of the 1,500+ icons can be found.
export const ICON_KEYWORDS = [
  ['커피 카페 coffee', ['Coffee', 'CoffeeBean']],
  ['맥주 술 beer', ['BeerStein', 'BeerBottle']],
  ['와인 술 분위기 wine', ['Wine', 'Champagne', 'Martini', 'Brandy']],
  ['차 음료 tea drink', ['TeaBag', 'Drop', 'OrangeSlice']],
  ['음식 밥 맛 식사 food', ['BowlFood', 'BowlSteam', 'ForkKnife', 'CookingPot', 'Knife']],
  ['빵 베이커리 bread', ['Bread', 'Grains', 'Cheese']],
  ['디저트 케이크 달콤 dessert', ['Cake', 'Cookie', 'IceCream', 'Popcorn']],
  ['피자 햄버거 패스트푸드', ['Pizza', 'Hamburger']],
  ['해산물 생선 fish', ['Fish', 'Shrimp']],
  ['채식 비건 건강 vegan', ['Leaf', 'Plant', 'Carrot', 'Avocado', 'GrainsSlash']],
  ['매운 맵다 spicy', ['Pepper', 'Fire', 'Flame']],
  ['고기 meat', ['Cow', 'Egg']],
  ['친절 사장님 서비스 staff', ['HandHeart', 'Handshake', 'Smiley', 'Heart']],
  ['가격 가성비 저렴 할인 price', ['CoinVertical', 'Coins', 'Money', 'PiggyBank', 'Tag', 'CurrencyEur']],
  ['분위기 감성 예쁜 mood', ['Sparkle', 'StarFour', 'Lightbulb', 'Palette', 'Flower']],
  ['와이파이 인터넷 wifi', ['WifiHigh']],
  ['공부 작업 노트북 study', ['Books', 'BookOpen', 'Student', 'Laptop']],
  ['좌석 의자 편안 seat', ['Armchair', 'Chair', 'Couch']],
  ['콘센트 충전 plug', ['Plug', 'BatteryCharging']],
  ['음악 노래 music', ['MusicNotes', 'MusicNote', 'Microphone', 'Guitar', 'PianoKeys']],
  ['조용 시끄러움 quiet', ['SpeakerSlash', 'SpeakerHigh']],
  ['빠른 시간 대기 fast', ['Clock', 'Timer', 'Lightning']],
  ['넓은 공간 단체 group', ['ArrowsOut', 'Users', 'UsersThree']],
  ['반려동물 강아지 고양이 pet', ['Dog', 'Cat', 'PawPrint']],
  ['깨끗 청결 clean', ['Broom', 'Sparkle', 'Toilet']],
  ['야외 테라스 날씨 outdoor', ['Sun', 'Tree', 'Umbrella', 'Snowflake', 'Thermometer']],
  ['밤 늦게 night', ['Moon']],
  ['주차 교통 접근 access', ['Car', 'Bicycle', 'Scooter', 'Bus', 'Train', 'MapPin', 'Wheelchair']],
  ['사진 인스타 photo', ['Camera']],
  ['게임 놀거리 fun', ['GameController', 'Confetti', 'Ticket', 'Television']],
  ['운동 헬스 sport', ['Barbell', 'PersonSimpleRun', 'Heartbeat']],
  ['선물 이벤트 gift', ['Gift', 'Medal', 'Trophy', 'Crown', 'Diamond']],
  ['쇼핑 가게 shop', ['Storefront', 'ShoppingBag', 'Basket', 'Package']],
  ['영어 외국어 대화 language', ['Translate', 'ChatCircle', 'ChatsCircle']],
  ['아기 가족 kids', ['Baby']],
  ['좋아요 추천 별 like', ['ThumbsUp', 'Star', 'Heart', 'Clover']],
]

/** Names to show first, in this order, when the search box is empty. */
export const SUGGESTED_ICON_NAMES = Array.from(new Set(ICON_KEYWORDS.flatMap(([, names]) => names)))

/**
 * Icon names matching a search, best first: keyword hits, then names that
 * start with the query, then names that contain it.
 */
export function searchIconNames(query, allNames) {
  const available = new Set(allNames)
  const q = String(query || '').trim().toLowerCase()
  if (!q) {
    const suggested = SUGGESTED_ICON_NAMES.filter((name) => available.has(name))
    const suggestedSet = new Set(suggested)
    return [...suggested, ...allNames.filter((name) => !suggestedSet.has(name))]
  }
  const results = []
  const seen = new Set()
  const add = (name) => {
    if (available.has(name) && !seen.has(name)) {
      seen.add(name)
      results.push(name)
    }
  }
  ICON_KEYWORDS.forEach(([words, names]) => {
    if (words.toLowerCase().split(' ').some((word) => word.includes(q) || q.includes(word))) names.forEach(add)
  })
  allNames.filter((name) => name.toLowerCase().startsWith(q)).forEach(add)
  allNames.filter((name) => name.toLowerCase().includes(q)).forEach(add)
  return results
}
