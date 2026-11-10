import {
  SCRAP_LINE,
  SCRAP_MARGIN_X,
  scrapTextLineHeight,
} from '../../domain/scrapBoard'

export const SCRAP_PAPER_COLOR = '#fffdf7'

/** Notebook background: red margin line on the left, blue ruled lines. */
export function scrapPaperBackground() {
  return {
    backgroundColor: SCRAP_PAPER_COLOR,
    backgroundImage: [
      `linear-gradient(to right, transparent ${SCRAP_MARGIN_X}px, #f87171 ${SCRAP_MARGIN_X}px, #f87171 ${SCRAP_MARGIN_X + 2}px, transparent ${SCRAP_MARGIN_X + 2}px)`,
      `repeating-linear-gradient(to bottom, transparent 0, transparent ${SCRAP_LINE - 1}px, #bfdbfe ${SCRAP_LINE - 1}px, #bfdbfe ${SCRAP_LINE}px)`,
    ].join(', '),
  }
}

export function scrapTextStyle(item) {
  return {
    fontSize: item.fs,
    lineHeight: `${scrapTextLineHeight(item.fs)}px`,
    color: item.c,
    fontWeight: item.b ? 700 : 500,
    whiteSpace: 'pre-wrap',
    wordBreak: 'keep-all',
    overflowWrap: 'anywhere',
  }
}
