import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import type { ObserverStatusActive } from '@/api/types'

const DJ_PLAYLIST_URI = 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq'

// narration length when the item does not report one, and a ceiling on any it does
const DEFAULT_NARRATION_MS = 5_000
const MAX_NARRATION_MS = 15_000
// speech is never really this short. Below it the reported duration is a compressed time base,
// so it is treated as missing rather than trusted
const MIN_PLAUSIBLE_NARRATION_MS = 3_000

// whether a uri belongs to a narration. Queue entries carry no metadata, so this is all they have
export function isNarrationUri(uri: string | undefined): boolean {
  return uri?.startsWith('spotify:media:') ?? false
}

// whether this status is the narration item itself, not whether the DJ is talking.
// the scheme is structural, raw_metadata is optional, so the uri is checked first
export function isNarrationItem(status: ObserverStatusActive | null): boolean {
  if (!status) return false
  return isNarrationUri(status.track_uri) || status.raw_metadata?.is_narration === 'true'
}

// measured against narration items reporting a duration for the same script: median 3.55,
// spread 1.96-4.51. Raise it to end the card sooner, lower it to hold longer
const WORDS_PER_SECOND = 3.55
// floor only guards against a flash on a very short line
const MIN_SONG_LINE_MS = 1_500
// the line starts over the previous track, so part of it is already spoken by the time this
// song's clock starts. Measured at ~3400 (audio.fade_overlap); the full value ends the card on
// time but hides short lines completely, so this trims the overrun without losing them
const NARRATION_LEAD_IN_MS = 2_000

// a DJ line carried on the song itself rather than as a media item
export interface SongNarration {
  title: string
  artist: string
  ms: number
}

function speechMsFromSsml(ssml: string): number {
  const words = ssml
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/).length
  return (words / WORDS_PER_SECOND) * 1000
}

// the DJ line a song carries, spoken over its opening. Null when the song has none
export function songNarration(status: ObserverStatusActive | null): SongNarration | null {
  const metadata = status?.raw_metadata
  if (!metadata) return null
  // the intro is the line that plays unless the listener jumped in, and it is what the
  // calibration was measured against
  const script = metadata['narration.intro.ssml'] || metadata['narration.jump.ssml']
  if (!script) return null
  return {
    title: metadata['narration.intro.title'] || metadata['narration.jump.title'] || 'Up next',
    artist: metadata['narration.intro.artist'] || metadata['narration.jump.artist'] || 'DJ X',
    ms: Math.min(
      Math.max(speechMsFromSsml(script) - NARRATION_LEAD_IN_MS, MIN_SONG_LINE_MS),
      MAX_NARRATION_MS,
    ),
  }
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
  // shared with the song the narration introduces, so it says what the hold belongs to
  trackId: string
  ms: number
  title: string
  artist: string
}

// builds the record the observer reducer stores
export function seenNarrationFrom(status: ObserverStatusActive): SeenNarration {
  const remaining =
    status.duration >= MIN_PLAUSIBLE_NARRATION_MS
      ? status.duration - status.position
      : DEFAULT_NARRATION_MS
  return {
    uri: status.track_uri,
    trackId: status.track_id,
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
  } else if (
    current !== null &&
    (!inDJSet || status == null || status.track_id !== current.trackId)
  ) {
    // the speech has no subject once the track it introduced is gone, eg. a skip.
    // keep armedUri: a spent record must not re-arm
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

  // a narration item is never presentable as a track, so cover the whole time it is current,
  // including the silent pre-roll and the stretch after the hold's clock has run out
  const narrationIsCurrent = status != null && isNarrationItem(status)

  // the line the song carries, spoken over its opening. Clocked on position, so it freezes
  // when paused and resets on a skip
  const song = narrationIsCurrent ? null : songNarration(status)
  // an item introducing this song shares its id, and its own hold already covers the speech
  const coveredByItem = seen != null && status != null && seen.trackId === status.track_id
  const songTalking =
    song != null &&
    status != null &&
    !coveredByItem &&
    !status.is_paused &&
    status.position < song.ms

  // what to credit the speech to, first match winning: the narration item itself, then the
  // line the song carries, then the hold left over from an item that is no longer current
  let speaker: { title: string; artist: string } | null = null
  if (narrationIsCurrent && status != null) {
    speaker = { title: status.track_name, artist: status.track_artist }
  } else if (songTalking && song != null) {
    speaker = song
  } else if (current != null) {
    speaker = current
  }

  const narrating = speaker !== null
  const title = speaker?.title ?? ''
  const artist = speaker?.artist ?? ''

  // memoised on the strings, not on status, so consumers do not re-render each position tick
  return useMemo(
    () => (narrating ? { narrating: true, title, artist } : NOT_NARRATING),
    [narrating, title, artist],
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
