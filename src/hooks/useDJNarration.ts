import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import type { ObserverStatusActive } from '@/api/types'

const DJ_PLAYLIST_URI = 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq'

// narration length when the item does not report one, and a ceiling on any it does
const DEFAULT_NARRATION_MS = 5_000
const MAX_NARRATION_MS = 15_000

// whether this status is the narration item itself, not whether the DJ is talking
// (the DJ X fallback is a display string, so it may not hold in other locales)
export function isNarrationItem(status: ObserverStatusActive | null): boolean {
  const metadata = status?.raw_metadata
  if (!metadata) return false
  return metadata.is_narration === 'true' || metadata.album_artist_name === 'DJ X'
}

// whether a DJ set is playing
export function isDJContext(status: ObserverStatusActive | null): boolean {
  if (!status) return false
  if (status.raw_metadata?.agentic_product_type === 'dj') return true
  return status.context_uri === DJ_PLAYLIST_URI
}

export interface DJNarration {
  narrating: boolean
  title: string
  artist: string
}

const NOT_NARRATING: DJNarration = { narrating: false, title: '', artist: '' }

// a narration item seen on the wire, and how much of its speech is left
export interface SeenNarration {
  uri: string
  ms: number
  title: string
  artist: string
}

// builds the record the observer reducer stores
export function seenNarrationFrom(status: ObserverStatusActive): SeenNarration {
  const remaining = status.duration > 0 ? status.duration - status.position : DEFAULT_NARRATION_MS
  return {
    uri: status.track_uri,
    ms: Math.min(Math.max(remaining, 0) || DEFAULT_NARRATION_MS, MAX_NARRATION_MS),
    title: status.track_name,
    artist: status.track_artist,
  }
}

// whether the DJ is talking, held for the length of the speech
export function useDJNarration(
  status: ObserverStatusActive | null,
  seen: SeenNarration | null,
): DJNarration {
  // armedUri outlives the hold, so a spent record cannot re-arm it
  const [state, setState] = useState<{ armedUri: string; active: SeenNarration | null }>({
    armedUri: '',
    active: null,
  })

  const inDJSet = isDJContext(status)

  let current = state.active
  if (inDJSet && seen != null && state.armedUri !== seen.uri) {
    current = seen
    setState({ armedUri: seen.uri, active: seen })
  } else if (!inDJSet && state.active !== null) {
    // keep armedUri: a spent record must not re-arm if the set is re-entered
    current = null
    setState((prev) => ({ ...prev, active: null }))
  }

  // ends the hold. setState runs in the timer, not the effect body, per set-state-in-effect
  useEffect(() => {
    if (!current) return
    const t = window.setTimeout(
      () => setState((prev) => ({ ...prev, active: null })),
      current.ms + 30,
    )
    return () => window.clearTimeout(t)
  }, [current])

  // memoised so the context value keeps its identity and consumers do not re-render each tick
  return useMemo(
    () =>
      current ? { narrating: true, title: current.title, artist: current.artist } : NOT_NARRATING,
    [current],
  )
}

// narration state, provided by App. Defaults to not narrating so consumers work without it
export const NarrationContext = createContext<DJNarration>(NOT_NARRATING)

// reads the narration state
export function useNarration(): DJNarration {
  return useContext(NarrationContext)
}

export interface TrackPresentation {
  title: string
  artist: string
  art: string
  djFallback: boolean
}

// what to display for the current item, substituting the DJ while it talks
export function presentTrack(
  status: ObserverStatusActive,
  narration: DJNarration,
): TrackPresentation {
  if (narration.narrating) {
    return { title: narration.title, artist: narration.artist, art: '', djFallback: true }
  }
  return {
    title: status.track_name,
    artist: status.track_artist,
    art: status.track_image,
    djFallback: false,
  }
}
