import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  isDJContext,
  seenNarrationFrom,
  useDJNarration,
  type SeenNarration,
} from '../useIsDJContext'
import { activeStatus } from '../../__tests__/fixtures/observer'
import type { ObserverStatusActive } from '@/api/types'

const DJ_URI = 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq'

// shapes taken from a real 4Hz capture of the daemon during a DJ set
function djSong(over: Partial<ObserverStatusActive> = {}): ObserverStatusActive {
  return {
    ...activeStatus,
    context_uri: DJ_URI,
    track_uri: 'spotify:track:song1',
    track_name: 'Joshua Tree',
    track_artist: 'Cautious Clay',
    track_image: 'https://x/song.jpg',
    duration: 197551,
    position: 357,
    raw_metadata: { agentic_product_type: 'dj', title: 'Joshua Tree' },
    ...over,
  }
}

function djNarration(over: Partial<ObserverStatusActive> = {}): ObserverStatusActive {
  return {
    ...activeStatus,
    context_uri: DJ_URI,
    // narration uris are ephemeral and unique per narration
    track_uri: 'spotify:track:narration1',
    track_name: 'Up next',
    track_artist: 'DJ X',
    track_image: 'https://lexicon-assets.spotifycdn.com/Your-DJ-Cover-Art-300.png',
    duration: 5302,
    position: 203,
    raw_metadata: {
      agentic_product_type: 'dj',
      is_narration: 'true',
      album_artist_name: 'DJ X',
      title: 'Up next',
    },
    ...over,
  }
}

describe('isDJContext', () => {
  it('is false with no status', () => {
    expect(isDJContext(null)).toBe(false)
  })

  it('identifies a DJ set from agentic_product_type on a song', () => {
    // every item in a DJ set carries this, songs included, so no latching is needed
    expect(isDJContext(djSong())).toBe(true)
  })

  it('identifies a DJ set on the narration item too', () => {
    expect(isDJContext(djNarration())).toBe(true)
  })

  it('still falls back to the DJ playlist uri', () => {
    expect(isDJContext({ ...activeStatus, context_uri: DJ_URI, raw_metadata: null })).toBe(true)
  })

  it('is false for a normal playlist', () => {
    const normal = { ...activeStatus, context_uri: 'spotify:playlist:regular', raw_metadata: null }
    expect(isDJContext(normal)).toBe(false)
  })
})

describe('seenNarrationFrom', () => {
  it('takes the remaining speech time from the narration item', () => {
    // duration 5302 - position 203
    expect(seenNarrationFrom(djNarration())).toEqual({
      uri: 'spotify:track:narration1',
      ms: 5099,
      title: 'Up next',
      artist: 'DJ X',
    })
  })

  it('falls back to a default when duration is missing', () => {
    expect(seenNarrationFrom(djNarration({ duration: 0, position: 0 })).ms).toBe(5000)
  })

  it('caps an absurd duration', () => {
    expect(seenNarrationFrom(djNarration({ duration: 60 * 60 * 1000, position: 0 })).ms).toBe(15000)
  })
})

describe('useDJNarration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  type Args = [ObserverStatusActive | null, SeenNarration | null]

  function setup(initialProps: Args) {
    return renderHook(([s, seen]: Args) => useDJNarration(s, seen), { initialProps })
  }

  it('is not narrating for a plain song with nothing seen', () => {
    const { result } = setup([djSong(), null])
    expect(result.current.narrating).toBe(false)
  })

  it('holds even though the narration item was never rendered as current status', () => {
    // this is the Spotify-triggered path: React batches the narration away, so the hook only
    // ever sees the next song as status, plus the record the reducer captured
    const seen = seenNarrationFrom(djNarration())
    const { result } = setup([djSong(), seen])

    expect(result.current.narrating).toBe(true)
    expect(result.current.title).toBe('Up next')
    expect(result.current.artist).toBe('DJ X')
  })

  it('still works when the narration item is the rendered status', () => {
    const seen = seenNarrationFrom(djNarration())
    const { result } = setup([djNarration(), seen])
    expect(result.current.narrating).toBe(true)
  })

  it('stops narrating once the speech duration elapses', () => {
    const seen = seenNarrationFrom(djNarration())
    const { result, rerender } = setup([djSong(), seen])
    expect(result.current.narrating).toBe(true)

    vi.advanceTimersByTime(5200)
    rerender([djSong(), seen])

    expect(result.current.narrating).toBe(false)
  })

  it('does not re-arm from the same narration record after it expires', () => {
    // the reducer keeps the record around, so a stale one must not restart the hold
    const seen = seenNarrationFrom(djNarration())
    const { result, rerender } = setup([djSong(), seen])

    vi.advanceTimersByTime(5200)
    rerender([djSong(), seen])
    expect(result.current.narrating).toBe(false)

    rerender([djSong(), seen])
    expect(result.current.narrating).toBe(false)
  })

  it('re-arms on the next narration', () => {
    const first = seenNarrationFrom(djNarration())
    const { result, rerender } = setup([djSong(), first])

    vi.advanceTimersByTime(5400)
    rerender([djSong(), first])
    expect(result.current.narrating).toBe(false)

    const second = seenNarrationFrom(
      djNarration({ track_uri: 'spotify:track:narration2', duration: 4597, position: 253 }),
    )
    rerender([djSong(), second])
    expect(result.current.narrating).toBe(true)
  })

  it('drops the hold when playback leaves the DJ set', () => {
    const seen = seenNarrationFrom(djNarration())
    const { result, rerender } = setup([djSong(), seen])
    expect(result.current.narrating).toBe(true)

    const normal = { ...activeStatus, context_uri: 'spotify:playlist:regular', raw_metadata: null }
    rerender([normal, seen])
    expect(result.current.narrating).toBe(false)
  })
})
