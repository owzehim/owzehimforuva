import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { CRITERIA_LABEL_MAX, DEFAULT_REVIEW_CRITERIA } from '../../domain/reviewCriteria'
import PlaceIcon from '../icons/PlaceIcon'
import { PHOSPHOR_ICON_NAMES } from '../icons/phosphorIconLoader'
import { searchIconNames } from '../icons/iconKeywords'

const PAGE_SIZE = 63

function IconPicker({ title, current, onPick, onClose }) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const inputRef = useRef(null)
  const results = useMemo(() => searchIconNames(query, PHOSPHOR_ICON_NAMES), [query])

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[1650]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-gray-900/45" onClick={onClose} aria-hidden="true" />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[80dvh] w-full max-w-xl flex-col rounded-t-3xl bg-white shadow-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex flex-shrink-0 items-center justify-between px-4 pb-2 pt-4">
          <p className="text-[15px] font-bold text-gray-900">{title}</p>
          <button type="button" onClick={onClose} aria-label="닫기" className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <X size={18} weight="bold" />
          </button>
        </div>
        <div className="flex-shrink-0 px-4 pb-3">
          <label className="flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2.5">
            <MagnifyingGlass size={18} className="text-gray-500" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setLimit(PAGE_SIZE)
              }}
              placeholder="검색 (예: 커피, 와이파이, chair)"
              className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
              aria-label="아이콘 검색"
            />
            <span className="flex-shrink-0 text-[11px] text-gray-400">{results.length.toLocaleString()}개</span>
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {results.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">찾는 아이콘이 없어요. 영어로도 검색해 보세요.</p>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {results.slice(0, limit).map((name) => {
                const active = name === current
                return (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    aria-label={name}
                    aria-pressed={active}
                    onClick={() => onPick(name)}
                    className={
                      'flex aspect-square items-center justify-center rounded-xl transition-colors ' +
                      (active ? 'bg-orange-50 ring-2 ring-orange-500' : 'bg-white ring-1 ring-gray-100 active:bg-gray-100')
                    }
                  >
                    <PlaceIcon name={name} size={22} weight={active ? 'fill' : 'regular'} color={active ? '#f97316' : '#374151'} />
                  </button>
                )
              })}
            </div>
          )}
          {results.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((value) => value + PAGE_SIZE * 2)}
              className="mt-3 w-full rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-600"
            >
              더 보기
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 멤버 평가 항목 for one place: the default restaurant set, or 4 custom
 * names with icons. value is null (default) or [{ label, icon }] × 4.
 */
export default function ReviewCriteriaEditor({ value, onChange, changed }) {
  const custom = Array.isArray(value)
  const rows = Array.isArray(value) && value.length === 4 ? value : DEFAULT_REVIEW_CRITERIA
  const [pickerIndex, setPickerIndex] = useState(null)

  const update = (index, patch) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  return (
    <div>
      <label className="text-sm text-gray-500 block mb-1">멤버 평가 항목</label>
      <div className="grid grid-cols-2 gap-2">
        {[
          { key: 'default', label: '기본 (식당)', active: !custom, onClick: () => onChange(null) },
          { key: 'custom', label: '직접 정하기', active: custom, onClick: () => onChange(rows.map((row) => ({ ...row }))) },
        ].map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={option.onClick}
            aria-pressed={option.active}
            className={
              'rounded-lg border px-3 py-2 text-sm font-medium transition-colors ' +
              (option.active ? 'border-orange-500 bg-orange-50 text-orange-600' : 'border-gray-200 bg-white text-gray-500')
            }
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-2 space-y-2">
        {rows.map((row, index) => (
          <div key={index} className={'flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-2 ' + (custom ? '' : 'opacity-60')}>
            <button
              type="button"
              disabled={!custom}
              onClick={() => setPickerIndex(index)}
              aria-label={`항목 ${index + 1} 아이콘 바꾸기`}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-orange-50 disabled:cursor-default"
            >
              <PlaceIcon name={row.icon} size={22} weight="fill" color="#f97316" />
            </button>
            <input
              value={row.label}
              disabled={!custom}
              maxLength={CRITERIA_LABEL_MAX}
              onChange={(event) => update(index, { label: event.target.value })}
              aria-label={`항목 ${index + 1} 이름`}
              className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:border-transparent disabled:bg-transparent"
            />
            <span className="flex-shrink-0 pr-1 text-[11px] text-gray-400">항목 {index + 1}</span>
          </div>
        ))}
      </div>
      <p className={'mt-1 text-xs ' + (changed ? 'text-orange-600' : 'text-gray-400')}>
        항목을 바꾸고 저장하면 이 장소의 멤버 평가 수가 0부터 다시 시작돼요. 지난 리뷰와 시트 기록은 그대로 남아요.
      </p>

      {pickerIndex !== null && (
        <IconPicker
          title={`‘${rows[pickerIndex].label || `항목 ${pickerIndex + 1}`}’ 아이콘`}
          current={rows[pickerIndex].icon}
          onPick={(name) => {
            update(pickerIndex, { icon: name })
            setPickerIndex(null)
          }}
          onClose={() => setPickerIndex(null)}
        />
      )}
    </div>
  )
}
