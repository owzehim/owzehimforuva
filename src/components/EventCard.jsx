import { Calendar, MapPin } from '@phosphor-icons/react'

export default function EventCard({ event, isExpanded, onToggle }) {
  const W = 'calc(100vw - 32px)' // Same width calculation as your design
  
  // Font sizes based on viewport width
  const fs = {
    day: `calc(${W} * 0.028)`,      // Small day text
    date: `calc(${W} * 0.068)`,     // Big date numbers (13.12)
    month: `calc(${W} * 0.052)`,    // Big month letters (DEC)
    title: `calc(${W} * 0.042)`,    // Event title
    location: `calc(${W} * 0.036)`, // Location text
  }

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return null
    const date = new Date(dateStr)
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
    const monthName = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
    
    return {
      dayName,
      dateNum: `${day}.${month}`,
      monthName,
      full: date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    }
  }

  const dateInfo = formatDate(event.event_date)

  return (
    <div className="mb-4">
      <button
        onClick={onToggle}
        className="w-full text-left p-4 bg-white rounded-2xl border border-gray-100 hover:border-orange-200 transition-colors"
      >
        <div className="flex gap-4">
          {/* LEFT SIDE - Date Info */}
          {dateInfo && (
            <div className="flex-shrink-0 flex flex-col items-start justify-start" style={{ minWidth: '80px' }}>
              {/* Day name */}
              <span
                style={{
                  fontFamily: 'var(--font-app)',
                  fontSize: fs.day,
                  fontWeight: 500,
                  color: '#9ca3af',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  lineHeight: 1,
                }}
              >
                {dateInfo.dayName}
              </span>
              
              {/* Date number */}
              <span
                style={{
                  fontFamily: 'var(--font-app)',
                  fontSize: fs.date,
                  fontWeight: 800,
                  color: '#1f2937',
                  letterSpacing: '0.02em',
                  lineHeight: 1,
                  marginTop: '2px',
                }}
              >
                {dateInfo.dateNum}
              </span>
              
              {/* Month name */}
              <span
                style={{
                  fontFamily: 'var(--font-app)',
                  fontSize: fs.month,
                  fontWeight: 700,
                  color: '#f97316',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  lineHeight: 1,
                  marginTop: '2px',
                }}
              >
                {dateInfo.monthName}
              </span>
            </div>
          )}

          {/* RIGHT SIDE - Event Info */}
          <div className="flex-1 flex flex-col justify-start">
            {/* Event Title */}
            <h3
              style={{
                fontFamily: 'var(--font-app)',
                fontSize: fs.title,
                fontWeight: 600,
                color: '#1f2937',
                margin: 0,
              }}
            >
              {event.title}
            </h3>

            {/* Location */}
            {event.location && (
              <div className="flex items-center gap-1.5 mt-1">
                <MapPin size={14} weight="fill" className="text-gray-400 flex-shrink-0" />
                <span
                  style={{
                    fontFamily: 'var(--font-app)',
                    fontSize: fs.location,
                    fontWeight: 400,
                    color: '#6b7280',
                  }}
                >
                  {event.location}
                </span>
              </div>
            )}

            {/* Expand indicator */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-gray-400">
                {isExpanded ? '▲' : '▼'}
              </span>
            </div>
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-2 p-4 bg-white rounded-2xl border border-gray-100">
          {event.description && (
            <p className="text-sm text-gray-600 mb-3">{event.description}</p>
          )}
          
          {event.image_urls && event.image_urls.length > 0 && (
            <div className="mb-3">
              <img
                src={event.image_urls[0]}
                alt={event.title}
                className="w-full h-40 object-cover rounded-lg"
              />
            </div>
          )}

          <div className="flex gap-2">
            {event.event_date && (
              <button className="flex-1 text-xs bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200 flex items-center justify-center gap-1.5">
                <Calendar size={14} weight="fill" />
                Add to Calendar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
