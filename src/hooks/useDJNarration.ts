import { createContext, useContext, useEffect, useState } from 'react'

import type { ObserverStatusActive } from '@/api/types'

// Every item in a DJ set - songs included - carries agentic_product_type: "dj", so this is
// the primary signal. The playlist uri is kept as a secondary one.
const DJ_PLAYLIST_URI = 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq'

// Spotify reports a narration item for only ~350-900ms but its duration is the real length
// of the speech (~5s observed), and the client keeps talking over the song that follows.
const DEFAULT_NARRATION_MS = 5_000
// a bad duration must not be able to wedge the DJ presentation on screen
const MAX_NARRATION_MS = 15_000

/**
 * Whether this status *is* the narration item. raw_metadata is the verbatim ProvidedTrack
 * metadata map from the daemon, and these keys appear on the narration item only, never on the
 * songs between narrations.
 *
 * This is a snapshot check, so it answers "is the narration item current", NOT "is the DJ
 * talking". Spotify keeps the item current for only 350-900ms while the speech runs ~5s, and
 * when the jump comes from the Spotify app the item is batched away before it ever renders.
 * Use `useNarration()` for the second question; this belongs in the observer reducer, which is
 * the one place that sees every status.
 */
export function isNarrationItem(status: ObserverStatusActive | null): boolean {
  const metadata = status?.raw_metadata
  if (!metadata) return false
  return metadata.is_narration === 'true' || metadata.album_artist_name === 'DJ X'
}

/** Whether a DJ set is playing at all. Used to decide the shuffle-slot button. */
export function isDJContext(status: ObserverStatusActive | null): boolean {
  if (!status) return false
  if (status.raw_metadata?.agentic_product_type === 'dj') return true
  return status.context_uri === DJ_PLAYLIST_URI
}

export interface DJNarration {
  /** true while the DJ is speaking, including after status moves on to the next song */
  narrating: boolean
  title: string
  artist: string
}

const NOT_NARRATING: DJNarration = { narrating: false, title: '', artist: '' }

/**
 * A narration item observed on the wire.
 *
 * Captured in the observer reducer rather than during render: the narration item is
 * superseded by the next song within ~350-900ms, and when both events land together React
 * batches them and never renders the narration. A reducer sees every action regardless.
 */
export interface SeenNarration {
  // ephemeral and unique per narration, so it doubles as the arm-once key
  uri: string
  // how much longer the DJ has to speak. A duration rather than a deadline, so nothing here
  // has to read the clock during render
  ms: number
  title: string
  artist: string
}

/** Builds the record stored by the observer reducer. Pure: no clock, no refs. */
export function seenNarrationFrom(status: ObserverStatusActive): SeenNarration {
  const remaining = status.duration > 0 ? status.duration - status.position : DEFAULT_NARRATION_MS
  return {
    uri: status.track_uri,
    ms: Math.min(Math.max(remaining, 0) || DEFAULT_NARRATION_MS, MAX_NARRATION_MS),
    title: status.track_name,
    artist: status.track_artist,
  }
}

/**
 * Whether the DJ is talking right now.
 *
 * The narration item disappears from the player state long before the speech ends, so we
 * take its duration as the authority and hold the presentation for the remainder. Without
 * the hold the screen flashes the DJ for half a second and then reveals the song while the
 * DJ is still mid-sentence.
 */
export function useDJNarration(
  status: ObserverStatusActive | null,
  seen: SeenNarration | null,
): DJNarration {
  // armedUri outlives the hold itself. The observer keeps the last narration record around,
  // so without remembering what we already consumed the hold would re-arm forever.
  const [state, setState] = useState<{ armedUri: string; active: SeenNarration | null }>({
    armedUri: '',
    active: null,
  })

  const inDJSet = isDJContext(status)

  // Armed from what the observer reducer saw, not from the rendered status: when Spotify
  // triggers the jump, the narration and the next song arrive together and React never
  // renders the narration item at all.
  let current = state.active
  if (inDJSet && seen != null && state.armedUri !== seen.uri) {
    current = seen
    setState({ armedUri: seen.uri, active: seen })
  } else if (!inDJSet && (state.active !== null || state.armedUri !== '')) {
    // leaving the set drops the hold, so a normal playlist can never inherit it
    current = null
    setState({ armedUri: '', active: null })
  }

  // re-render when the speech should be over. setState runs in the timer callback, not in the
  // effect body, so this stays clear of the repo's set-state-in-effect rule.
  useEffect(() => {
    if (!current) return
    const t = window.setTimeout(
      () => setState((prev) => ({ ...prev, active: null })),
      current.ms + 30,
    )
    return () => window.clearTimeout(t)
  }, [current])

  if (current) {
    // status has moved on to the next song, so show what the narration item reported. The
    // timer above is what ends the hold, so no clock read is needed here.
    return { narrating: true, title: current.title, artist: current.artist }
  }
  return NOT_NARRATING
}

/**
 * The narration state, provided once by App from `useDJNarration`.
 *
 * Defaults to NOT_NARRATING so a component rendered without a provider simply reads "not
 * narrating" rather than throwing, which keeps isolated component tests wrapper-free.
 */
export const NarrationContext = createContext<DJNarration>(NOT_NARRATING)

/** Read the narration state. Prefer this over passing it down as a prop. */
export function useNarration(): DJNarration {
  return useContext(NarrationContext)
}

export interface TrackPresentation {
  title: string
  artist: string
  /** empty while narrating: the status artwork belongs to the song that plays next */
  art: string
  /** tells AlbumArt to draw the DJ mark instead of an empty placeholder */
  djFallback: boolean
}

/**
 * What to actually show for the current item. While the DJ talks, status describes the song
 * queued behind the speech, so none of it may be displayed. Single source of truth for that
 * substitution, since more than one surface needs it.
 */
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
