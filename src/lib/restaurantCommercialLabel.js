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
const LABEL_SIZES = {
  // Under the map marker name.
  marker: { fontSize: '8px', lineHeight: '11px', padding: '1px 4px', borderRadius: '4px' },
  // Above the SpotCard: same badge, larger so it reads at a glance.
  card: { fontSize: '12px', lineHeight: '16px', padding: '3px 9px', borderRadius: '7px' },
}

export function getCommercialLabelStyle(type, dark = false, size = 'marker') {
  return {
    background: type === RESTAURANT_COMMERCIAL_LABEL_TYPES.PAID_AD
      ? PAID_AD_LABEL_COLOR
      : MEMBER_DISCOUNT_LABEL_COLOR,
    color: '#ffffff',
    fontWeight: '700',
    whiteSpace: 'nowrap',
    ...(LABEL_SIZES[size] || LABEL_SIZES.marker),
    boxShadow: dark ? '0 1px 3px rgba(0,0,0,0.35)' : '0 1px 3px rgba(0,0,0,0.12)',
  }
}
