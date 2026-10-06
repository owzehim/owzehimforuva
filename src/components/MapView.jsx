import { useEffect, useRef, useCallback, useState } from 'react'
import * as maptilersdk from '@maptiler/sdk'
import '@maptiler/sdk/dist/maptiler-sdk.css'

import { getMapIconSvg } from '../lib/mapCategories'
import { MapPinSimple } from '@phosphor-icons/react'

if (typeof window !== 'undefined' && !document.getElementById('map-view-performance-style')) {
  const style = document.createElement('style')
  style.id = 'map-view-performance-style'
  style.textContent = `
    .maplibregl-canvas { image-rendering: optimizeSpeed; }
    .maplibregl-marker.custom-marker {
      contain: layout style;
      backface-visibility: hidden;
      transform-style: preserve-3d;
    }
    .map-is-moving .maplibregl-marker.custom-marker {
      pointer-events: none;
      will-change: transform;
    }
    .map-is-moving .custom-marker .marker-circle {
      transition: none !important;
    }
    .maplibregl-ctrl-top-left { display: none !important; }
    .maplibregl-ctrl-top-right { display: none !important; }
    .maplibregl-ctrl-bottom-left { display: none !important; }
    .maplibregl-ctrl-bottom-right { display: none !important; }
    
    .custom-marker[data-selected="true"] .marker-circle {
      border: 3px solid #f97316 !important;
      box-shadow: 0 3px 12px rgba(249,115,22,0.5) !important;
    }
  `
  document.head.appendChild(style)
}

const API_KEY = import.meta.env.VITE_MAPTILER_API_KEY
const LIGHT_MAP_STYLE_ID = '019eb88d-92dc-70b4-b9c2-008b7e4a977d'
const DARK_MAP_STYLE_ID = '019e33af-3185-79df-9f26-1bc6d896eeee'
maptilersdk.config.apiKey = API_KEY

function getMapStyleUrl(isDark) {
  const styleId = isDark ? DARK_MAP_STYLE_ID : LIGHT_MAP_STYLE_ID
  return `https://api.maptiler.com/maps/${styleId}/style.json?key=${API_KEY}`
}

function isDarkMode() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

export default function MapView({ restaurants, selected, onSelect }) {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const markersRef = useRef(new Map())
  const userLocationMarkerRef = useRef(null)
  const locationWatchIdRef = useRef(null)
  const initializedRef = useRef(false)
  const mapReadyRef = useRef(false)
  const activeStyleRef = useRef(null)
  const selectedMarkerIdRef = useRef(null)
  const selectedRef = useRef(selected)
  const restaurantsRef = useRef(restaurants)
  const movingClassTimeoutRef = useRef(null)
  const [isTrackingLocation, setIsTrackingLocation] = useState(false)
  const [darkMapControls, setDarkMapControls] = useState(isDarkMode)

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    restaurantsRef.current = restaurants
  }, [restaurants])

  const createMarkerElement = useCallback((r, isSelected = false) => {
    const dark = isDarkMode()
    const isSponsored = r.is_sponsored
    const size = isSponsored ? 42 : 34
    const bg = isSponsored ? '#f97316' : dark ? '#121212' : 'white'
    const border = isSponsored
      ? `3px solid ${dark ? '#121212' : 'white'}`
      : isSelected
        ? '3px solid #f97316'
        : `2px solid ${dark ? '#f97316' : '#e5e7eb'}`
    const shadow = isSelected
      ? '0 3px 12px rgba(249,115,22,0.5)'
      : isSponsored
        ? '0 3px 12px rgba(249,115,22,0.4)'
        : dark
          ? '0 2px 10px rgba(0,0,0,0.55)'
          : '0 2px 6px rgba(0,0,0,0.15)'
    const displayName = r.map_label || r.name || ''
    const iconColor = isSponsored ? (dark ? '#121212' : 'white') : '#f97316'
    const iconSvg = getMapIconSvg(r.category, iconColor)

    const el = document.createElement('div')
    el.className = 'custom-marker'
    el.setAttribute('data-id', r.id)
    el.setAttribute('data-selected', isSelected ? 'true' : 'false')
    el.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      cursor: pointer;
    `

    const markerCircle = document.createElement('div')
    markerCircle.className = 'marker-circle'
    markerCircle.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      background: ${bg};
      border: ${border};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: ${shadow};
      flex-shrink: 0;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    `

    const iconContainer = document.createElement('div')
    iconContainer.style.cssText = `
      width: ${isSponsored ? 24 : 16}px;
      height: ${isSponsored ? 24 : 16}px;
      display: flex;
      align-items: center;
      justify-content: center;
    `
    iconContainer.innerHTML = iconSvg
    markerCircle.appendChild(iconContainer)

    const label = document.createElement('div')
    label.style.cssText = `
      background: ${dark ? '#121212' : 'white'};
      color: ${dark ? '#ffffff' : '#374151'};
      font-size: 9px;
      font-weight: 600;
      line-height: 12px;
      padding: 1px 4px;
      border-radius: 4px;
      white-space: nowrap;
      border: ${dark ? '1px solid #2c2c2e' : 'none'};
      box-shadow: ${dark ? '0 2px 8px rgba(0,0,0,0.5)' : '0 1px 3px rgba(0,0,0,0.1)'};
      max-width: none;
      overflow: visible;
    `
    label.textContent = displayName

    el.appendChild(markerCircle)
    el.appendChild(label)

    return el
  }, [])

  const renderMarkers = useCallback((data) => {
    if (!map.current || !mapReadyRef.current) return

    markersRef.current.forEach(({ marker }) => marker.remove())
    markersRef.current.clear()
    selectedMarkerIdRef.current = null

    const valid = (data || []).filter((r) => r.latitude && r.longitude)
    if (valid.length === 0) return

    const sorted = [...valid].sort(
      (a, b) => (a.is_sponsored ? 1 : 0) - (b.is_sponsored ? 1 : 0),
    )
    const selectedId = selectedRef.current?.id ?? null

    sorted.forEach((r) => {
      const isSelected = r.id === selectedId
      const el = createMarkerElement(r, isSelected)
      const marker = new maptilersdk.Marker({ element: el })
        .setLngLat([r.longitude, r.latitude])
        .addTo(map.current)

      el.addEventListener('click', () => onSelect(r))

      markersRef.current.set(r.id, { marker, element: el, isSponsored: r.is_sponsored })
    })

    selectedMarkerIdRef.current = markersRef.current.has(selectedId) ? selectedId : null

    if (valid.length === 1) {
      map.current.flyTo({
        center: [valid[0].longitude, valid[0].latitude],
        zoom: 15,
        duration: 1000,
      })
    } else if (valid.length > 1) {
      const bounds = valid.reduce(
        (b, r) => b.extend([r.longitude, r.latitude]),
        new maptilersdk.LngLatBounds(
          [valid[0].longitude, valid[0].latitude],
          [valid[0].longitude, valid[0].latitude],
        ),
      )
      map.current.fitBounds(bounds, { padding: 40, duration: 1000 })
    }
  }, [createMarkerElement, onSelect])

  useEffect(() => {
    if (initializedRef.current || !mapContainer.current) return
    initializedRef.current = true

    map.current = new maptilersdk.Map({
      container: mapContainer.current,
      style: getMapStyleUrl(isDarkMode()),
      center: [4.9041, 52.3676],
      zoom: 13,
      antialias: false,
      attributionControl: false,
      fadeDuration: 0,
      optimizeForTerrain: false,
      preserveDrawingBuffer: false,
      pitch: 0,
      bearing: 0,
    })

    map.current.dragRotate.disable()
    map.current.touchZoomRotate.disableRotation()

    const setMapMovingClass = (isMoving) => {
      if (!mapContainer.current) return
      if (movingClassTimeoutRef.current != null) {
        window.clearTimeout(movingClassTimeoutRef.current)
        movingClassTimeoutRef.current = null
      }

      if (isMoving) {
        mapContainer.current.classList.add('map-is-moving')
        return
      }

      movingClassTimeoutRef.current = window.setTimeout(() => {
        mapContainer.current?.classList.remove('map-is-moving')
        movingClassTimeoutRef.current = null
      }, 120)
    }

    map.current.on('movestart', () => setMapMovingClass(true))
    map.current.on('moveend', () => setMapMovingClass(false))

    map.current.on('load', () => {
      mapReadyRef.current = true
      activeStyleRef.current = getMapStyleUrl(isDarkMode())
      map.current.resize()
      renderMarkers(restaurantsRef.current)

      // The map tab can mount while its flex container is still settling.
      // A second resize on the next frame keeps markers visible immediately.
      window.requestAnimationFrame(() => {
        map.current?.resize()
        renderMarkers(restaurantsRef.current)
      })
    })

    return () => {
      if (movingClassTimeoutRef.current != null) {
        window.clearTimeout(movingClassTimeoutRef.current)
      }
      map.current?.remove()
      map.current = null
      initializedRef.current = false
      mapReadyRef.current = false
      markersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!map.current || typeof MutationObserver === 'undefined') return undefined

    const syncMapStyle = () => {
      setDarkMapControls(isDarkMode())
      const nextStyle = getMapStyleUrl(isDarkMode())
      if (activeStyleRef.current === nextStyle) return

      activeStyleRef.current = nextStyle
      mapReadyRef.current = false
      map.current.setStyle(nextStyle)
      map.current.once('style.load', () => {
        mapReadyRef.current = true
        renderMarkers(restaurants)
      })
    }

    const observer = new MutationObserver(syncMapStyle)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    syncMapStyle()

    return () => observer.disconnect()
  }, [restaurants, renderMarkers])

  useEffect(() => {
    if (mapReadyRef.current) {
      renderMarkers(restaurants)
    }
  }, [restaurants, renderMarkers])

  useEffect(() => {
    if (!mapReadyRef.current) return
    const dark = isDarkMode()

    const setMarkerSelected = (markerData, isSelected) => {
      if (!markerData) return
      const { element, isSponsored } = markerData
      element.setAttribute('data-selected', isSelected ? 'true' : 'false')
      const circle = element.querySelector('.marker-circle')
      if (!circle) return

      if (isSelected) {
        circle.style.border = '3px solid #f97316'
        circle.style.boxShadow = '0 3px 12px rgba(249,115,22,0.5)'
        return
      }

      if (isSponsored) {
        circle.style.border = `3px solid ${dark ? '#121212' : 'white'}`
        circle.style.boxShadow = '0 3px 12px rgba(249,115,22,0.4)'
      } else {
        circle.style.border = `2px solid ${dark ? '#f97316' : '#e5e7eb'}`
        circle.style.boxShadow = dark
          ? '0 2px 10px rgba(0,0,0,0.55)'
          : '0 2px 6px rgba(0,0,0,0.15)'
      }
    }

    const previousSelectedId = selectedMarkerIdRef.current
    const nextSelectedId = selected?.id ?? null

    if (previousSelectedId !== nextSelectedId) {
      setMarkerSelected(markersRef.current.get(previousSelectedId), false)
      setMarkerSelected(markersRef.current.get(nextSelectedId), true)
      selectedMarkerIdRef.current = nextSelectedId
      return
    }

    markersRef.current.forEach((markerData) => {
      const isSelected = markerData.element.getAttribute('data-selected') === 'true'
      setMarkerSelected(markerData, isSelected)
    })
  }, [selected, darkMapControls])

  useEffect(() => {
    if (!map.current || !selected) return
    const shouldLiftMarker =
      selected.spot_card_height === 'full' ||
      selected.spot_card_height === 'tall'

    map.current.flyTo({
      center: [selected.longitude, selected.latitude],
      zoom: 16,
      offset: shouldLiftMarker ? [0, -90] : [0, 0],
      duration: 1000,
    })
  }, [selected])

  const removeUserLocationMarker = useCallback(() => {
    if (userLocationMarkerRef.current) {
      userLocationMarkerRef.current.remove()
      userLocationMarkerRef.current = null
    }
  }, [])

  const stopLocationTracking = useCallback(() => {
    if (locationWatchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatchIdRef.current)
      locationWatchIdRef.current = null
    }
    removeUserLocationMarker()
    setIsTrackingLocation(false)
  }, [removeUserLocationMarker])

  const updateUserLocationMarker = useCallback((latitude, longitude, shouldCenter = false) => {
    if (!map.current) return

    if (!userLocationMarkerRef.current) {
      const dark = isDarkMode()
      const el = document.createElement('div')
      el.style.cssText = `
        width: 16px;
        height: 16px;
        background: #f97316;
        border: 2px solid ${dark ? '#121212' : 'white'};
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      `
      userLocationMarkerRef.current = new maptilersdk.Marker({ element: el })
        .setLngLat([longitude, latitude])
        .addTo(map.current)
    } else {
      userLocationMarkerRef.current.setLngLat([longitude, latitude])
    }

    if (shouldCenter) {
      map.current.flyTo({
        center: [longitude, latitude],
        zoom: 16,
        duration: 700,
      })
    }
  }, [])

  const toggleLocationTracking = () => {
    if (!map.current || !navigator.geolocation) {
      alert('현재 위치 기능을 사용할 수 없어요.')
      return
    }

    if (isTrackingLocation) {
      stopLocationTracking()
      return
    }

    const handlePosition = (position, shouldCenter = false) => {
      const { latitude, longitude } = position.coords
      updateUserLocationMarker(latitude, longitude, shouldCenter)
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        handlePosition(position, true)
        const watchId = navigator.geolocation.watchPosition(
          (nextPosition) => handlePosition(nextPosition, false),
          () => {
            stopLocationTracking()
            alert('위치를 가져올 수 없어요. 위치 권한을 허용해주세요.')
          },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
        )
        locationWatchIdRef.current = watchId
        setIsTrackingLocation(true)
      },
      () => {
        alert('위치를 가져올 수 없어요. 위치 권한을 허용해주세요.')
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    )
  }

  useEffect(() => {
    return () => {
      if (locationWatchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchIdRef.current)
      }
      removeUserLocationMarker()
    }
  }, [removeUserLocationMarker])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '300px' }}>
      <div
        ref={mapContainer}
        style={{
          width: '100%',
          height: '100%',
          minHeight: '300px',
          zIndex: 1,
        }}
      />
      <button
        onClick={toggleLocationTracking}
        aria-pressed={isTrackingLocation}
        style={{
          position: 'absolute',
          bottom: '80px',
          right: '16px',
          zIndex: 1000,
          background: isTrackingLocation ? '#f97316' : darkMapControls ? '#121212' : 'white',
          border: isTrackingLocation
            ? '1px solid #f97316'
            : darkMapControls
              ? '1px solid #2c2c2e'
              : 'none',
          borderRadius: '12px',
          width: '44px',
          height: '44px',
          padding: 0,
          boxShadow: isTrackingLocation
            ? '0 3px 12px rgba(249,115,22,0.35)'
            : darkMapControls
              ? '0 2px 10px rgba(0,0,0,0.55)'
              : '0 2px 8px rgba(0,0,0,0.15)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={isTrackingLocation ? '현재 위치 끄기' : '현재 위치 켜기'}
      >
        <MapPinSimple
          size={22}
          weight={isTrackingLocation ? 'fill' : 'bold'}
          color={isTrackingLocation ? (darkMapControls ? '#121212' : 'white') : '#f97316'}
        />
      </button>
    </div>
  )
}
