export const RESTAURANT_COMMERCIAL_LABEL_TYPES = {
  NONE: 'none',
  MEMBER_DISCOUNT: 'member_discount',
  PAID_AD: 'paid_ad',
}

export function getRestaurantCommercialLabelType(restaurant) {
  const type = restaurant?.commercial_display_type
  if (Object.values(RESTAURANT_COMMERCIAL_LABEL_TYPES).includes(type)) {
    return type
  }

  // Keep the old partnership marker readable before every database has migrated.
  return restaurant?.is_sponsored
    ? RESTAURANT_COMMERCIAL_LABEL_TYPES.MEMBER_DISCOUNT
    : RESTAURANT_COMMERCIAL_LABEL_TYPES.NONE
}

export function getRestaurantCommercialLabel(type) {
  if (type === RESTAURANT_COMMERCIAL_LABEL_TYPES.MEMBER_DISCOUNT) {
    return '회원 할인 제공'
  }
  if (type === RESTAURANT_COMMERCIAL_LABEL_TYPES.PAID_AD) {
    return '유료 광고'
  }
  return null
}
