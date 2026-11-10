import { SCRAP_WIDTH, decodePoints, strokePath } from '../../domain/scrapBoard'
import { scrapPaperBackground, scrapTextStyle } from './scrapPaperStyle'

/**
 * Renders the board at its logical size (SCRAP_WIDTH × height).
 * Callers scale it with a CSS transform.
 */
export default function ScrapPaper({ board, height, renderItem }) {
  return (
    <div
      className="scrap-paper relative"
      style={{ width: SCRAP_WIDTH, height, ...scrapPaperBackground() }}
    >
      {board.items.map((item, index) => {
        if (renderItem) return renderItem(item, index)
        return <ScrapItem key={item.id} item={item} />
      })}
    </div>
  )
}

export function ScrapItem({ item, style, children, hitArea = 0, ...rest }) {
  const base = {
    position: 'absolute',
    left: item.x,
    top: item.y,
    width: item.w,
    transform: item.r ? `rotate(${item.r}deg)` : undefined,
    ...style,
  }
  if (item.t === 'img') {
    return (
      <div {...rest} style={{ ...base, height: item.h }}>
        <img
          src={item.src}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="pointer-events-none h-full w-full select-none rounded-md object-cover"
          style={{ boxShadow: '0 3px 10px rgba(0,0,0,.16)', border: '3px solid #fff' }}
        />
        {children}
      </div>
    )
  }
  if (item.t === 'draw') {
    return (
      <div {...rest} style={{ ...base, height: item.h }}>
        <ScrapDrawingSvg item={item} hitArea={hitArea} />
        {children}
      </div>
    )
  }
  return (
    <div {...rest} style={{ ...base, ...scrapTextStyle(item) }}>
      {children ?? item.text}
    </div>
  )
}

/** hitArea > 0 adds invisible wide strokes so only the lines (not the empty box) can be tapped. */
export function ScrapDrawingSvg({ item, hitArea = 0 }) {
  return (
    <svg
      viewBox={`0 0 ${item.vw} ${item.vh}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      className="pointer-events-none block overflow-visible"
      aria-hidden="true"
    >
      {hitArea > 0 && item.s.map((stroke, index) => (
        <path
          key={`hit-${index}`}
          d={strokePath(decodePoints(stroke.p))}
          fill="none"
          stroke="transparent"
          strokeWidth={stroke.sw + hitArea * (item.vw / item.w)}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke' }}
        />
      ))}
      {item.s.map((stroke, index) => (
        <path
          key={index}
          d={strokePath(decodePoints(stroke.p))}
          fill="none"
          stroke={stroke.c}
          strokeWidth={stroke.sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}
