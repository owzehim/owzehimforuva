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
    return '할인 제공'
  }
  if (type === RESTAURANT_COMMERCIAL_LABEL_TYPES.PAID_AD) {
    return '유료 광고'
  }
  return null
}

export const PAID_AD_LABEL_COLOR = '#FFB81C'
export const MEMBER_DISCOUNT_LABEL_COLOR = '#f97316'

/**
 * Style of the 할인 제공 / 유료 광고 badge. Shared by the map marker and the
 * SpotCard so both always look the same.
 */
export function getCommercialLabelStyle(type, dark = false) {
  return {
    background: type === RESTAURANT_COMMERCIAL_LABEL_TYPES.PAID_AD
      ? PAID_AD_LABEL_COLOR
      : MEMBER_DISCOUNT_LABEL_COLOR,
    color: '#ffffff',
    fontSize: '8px',
    fontWeight: '700',
    lineHeight: '11px',
    padding: '1px 4px',
    borderRadius: '4px',
    whiteSpace: 'nowrap',
    boxShadow: dark ? '0 1px 3px rgba(0,0,0,0.35)' : '0 1px 3px rgba(0,0,0,0.12)',
  }
}
