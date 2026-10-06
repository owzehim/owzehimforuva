import { Octagon } from '@phosphor-icons/react'
import { sanitizeRichText } from '../../../lib/sanitizeHtml'

const SIZES = {
  mini: {
    cardWidth: 120,
    iconSize: 9,
    padding: 5,
    titleFont: '7px',
    subtitleFont: '6px',
    rewardFont: '6.5px',
    showDates: false,
    dateFont: '0px',
    stampGap: 4,
  },
  full: {
    cardWidth: '100%',
    iconSize: 24,
    padding: 14,
    titleFont: '15px',
    subtitleFont: '12px',
    rewardFont: '13px',
    showDates: true,
    dateFont: '9px',
    stampGap: 6,
  },
}

function hasMarkup(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value || '')
}

function RichText({ value, fallback, style }) {
  const content = value || fallback
  if (!content) return null

  if (hasMarkup(content)) {
    return (
      <div
        style={style}
        dangerouslySetInnerHTML={{ __html: sanitizeRichText(content) }}
      />
    )
  }

  return <p style={style}>{content}</p>
}

export default function StampCard({
  config,
  visits = [],
  size = 'full',
  isCardFull = false,
  highlighted = false,
  highlightColor,
}) {
  if (!config) return null

  const s = SIZES[size] ?? SIZES.full
  const hasWallpaper = !!config.wallpaper_url
  const stampsPerRow = Math.max(
    1,
    Math.min(config.stamps_per_row || config.total_stamps, config.total_stamps),
  )

  const slots = Array.from({ length: config.total_stamps }, (_, i) => ({
    filled: isCardFull || i < visits.length,
    date: i < visits.length ? visits[i].visited_at?.slice(0, 10) : null,
  }))

  const outerBg = hasWallpaper ? 'transparent' : (config.background_color || '#ffffff')
  const accentBg = hasWallpaper ? 'transparent' : (config.accent_color || '#ffffff')
  const textColor = config.text_color || '#111827'
  const stampColor = config.stamp_color || config.text_color || '#111827'
  const secondaryTextColor = config.text_color || '#6b7280'

  const cardStyle = {
    position: 'relative',
    width: s.cardWidth,
    aspectRatio: '1.586 / 1',
    borderRadius: 0,
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
    display: 'grid',
    gridTemplateRows: '25% 55% 20%',
    ...(highlighted && {
      boxShadow: `inset 0 0 0 3px ${highlightColor || '#f97316'}, 0 2px 8px rgba(0,0,0,0.12)`,
    }),
  }

  return (
    <div style={cardStyle}>
      {hasWallpaper && (
        <img
          src={config.wallpaper_url}
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 0,
          }}
        />
      )}

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          background: outerBg,
          padding: `${Math.round(s.padding * 0.7)}px ${s.padding}px`,
          textAlign: 'left',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <RichText
          value={config.title}
          style={{
            margin: 0,
            fontWeight: 600,
            fontSize: s.titleFont,
            color: textColor,
            lineHeight: 1.15,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        />
        <RichText
          value={config.subtitle}
          style={{
            margin: 0,
            fontSize: s.subtitleFont,
            color: secondaryTextColor,
            lineHeight: 1.15,
            marginTop: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        />
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          background: accentBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: `${Math.round(s.padding * 0.55)}px ${s.padding}px`,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${stampsPerRow}, minmax(${s.iconSize}px, max-content))`,
            justifyContent: 'center',
            alignContent: 'center',
            alignItems: 'start',
            gap: s.stampGap,
            maxWidth: '100%',
            maxHeight: '100%',
            overflow: 'hidden',
          }}
        >
          {slots.map((slot, i) => (
            <SlotItem
              key={i}
              slot={slot}
              iconSize={s.iconSize}
              textColor={stampColor}
              showDates={s.showDates}
              dateFont={s.dateFont}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          background: outerBg,
          padding: `${Math.round(s.padding * 0.45)}px ${s.padding}px`,
          textAlign: 'center',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <RichText
          value={config.reward_text}
          fallback={isCardFull ? '리워드를 획득하셨어요' : ''}
          style={{
          margin: 0,
          fontSize: s.rewardFont,
          fontWeight: isCardFull ? 700 : 500,
          color: textColor,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        />
      </div>
    </div>
  )
}

function SlotItem({ slot, iconSize, textColor, showDates, dateFont }) {
  const reservedDateHeight = showDates ? `calc(${dateFont} + 2px)` : 0

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: showDates ? `${iconSize}px ${reservedDateHeight}` : `${iconSize}px`,
        justifyItems: 'center',
        alignItems: 'start',
        rowGap: 2,
        minWidth: iconSize,
      }}
    >
      <Octagon
        size={iconSize}
        weight={slot.filled ? 'fill' : 'regular'}
        color={textColor}
        style={{ opacity: slot.filled ? 1 : 0.25, display: 'block', flexShrink: 0 }}
      />
      {showDates && (
        <span
          style={{
            minHeight: reservedDateHeight,
            fontSize: dateFont,
            color: textColor,
            lineHeight: 1,
            opacity: slot.filled && slot.date ? 1 : 0,
            whiteSpace: 'nowrap',
          }}
        >
          {slot.date || '0000-00-00'}
        </span>
      )}
    </div>
  )
}
