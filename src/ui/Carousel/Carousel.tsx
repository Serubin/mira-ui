import { useEffect, useEffectEvent, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPhantomFilter, decideAxis, type TouchPoint } from '@/gestures/swipeMachine'
import type { KnobNav } from '@/input/useKnobNav'
import { useUiScale } from '@/uiScale'
import { restOffsets, rubberBand, swipeTarget, trackOffset } from './carouselMath'
import styles from './Carousel.module.scss'

export interface CarouselProps<T, K extends string> {
  items: readonly T[]
  keyOf: (item: T) => K
  /** items need no click handler of their own: the carousel focuses then selects on tap */
  renderItem: (item: T, state: { focused: boolean; disabled: boolean }) => ReactNode
  /** built over `items.map(keyOf)` */
  nav: KnobNav<K>
  /** the focused item's inset from the left edge, in layout px; also the padding at each end */
  leadPx?: number
  className?: string
}

const DEFAULT_LEAD_PX = 24
// a tap that ends a drag would select whatever is under the finger
const CLICK_SUPPRESS_MS = 350

const translate = (x: number) => `translate3d(${-x}px, 0, 0)`

/**
 * A horizontal row driven by `useKnobNav`. The focused item widens by class, then the track
 * moves by transform to the item's measured offset, clamped at both ends. A one-finger drag
 * moves the track with the finger and focuses the item it is let go nearest.
 */
export function Carousel<T, K extends string>({
  items,
  keyOf,
  renderItem,
  nav,
  leadPx = DEFAULT_LEAD_PX,
  className,
}: CarouselProps<T, K>) {
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const placed = useRef(false)
  // where the track rests, which a drag starts from and springs back to
  const restOffset = useRef(0)
  const scale = useUiScale()

  // the width swap has no transition, so the offsets read here are already final
  useLayoutEffect(() => {
    const vp = viewport.current
    const tr = track.current
    const focused = tr?.children[nav.focusIndex] as HTMLElement | undefined
    const last = tr?.lastElementChild as HTMLElement | null | undefined
    if (!vp || !tr || !focused || !last) return
    const x = trackOffset({
      itemLeft: focused.offsetLeft,
      contentEnd: last.offsetLeft + last.offsetWidth,
      viewportWidth: vp.clientWidth,
      leadPx,
    })
    restOffset.current = x
    if (placed.current) {
      tr.style.transform = translate(x)
      return
    }
    placed.current = true
    tr.style.transition = 'none'
    tr.style.transform = translate(x)
    // flushes the jump, so the first placement does not animate in from zero
    void tr.offsetWidth
    tr.style.transition = ''
  }, [nav.focusIndex, items, leadPx, scale])

  const release = useEffectEvent((from: number, dx: number, rests: readonly number[]) => {
    const tr = track.current
    if (!tr) return
    tr.style.transition = ''
    const target = from < 0 ? from : swipeTarget(rests, from, restOffset.current - dx, dx)
    if (target !== from) nav.setFocus(keyOf(items[target]))
    else tr.style.transform = translate(restOffset.current)
  })

  useEffect(() => {
    const vp = viewport.current
    const tr = track.current
    if (!vp || !tr) return
    // drops the Car Thing's ghost fingers, as the player's swipes do
    const liveTouches = createPhantomFilter()
    const listOf = (l: TouchList): TouchPoint[] => Array.from(l)
    let drag: { x: number; y: number; dx: number; mode: 'undecided' | 'x' | 'y' } | null = null
    // fixed when the drag locks horizontal: the focused index and the track's resting offsets
    let from = -1
    let rests: number[] = []
    let max = 0
    let suppressClickUntil = 0

    const springBack = () => {
      tr.style.transition = ''
      tr.style.transform = translate(restOffset.current)
    }
    const cancel = () => {
      if (drag?.mode === 'x') springBack()
      drag = null
    }
    const lockHorizontal = () => {
      const items = Array.from(tr.children) as HTMLElement[]
      from = items.findIndex((c) => c.classList.contains(styles.focused))
      rests = restOffsets({
        lefts: items.map((c) => c.offsetLeft),
        widths: items.map((c) => c.offsetWidth),
        from: Math.max(from, 0),
        viewportWidth: vp.clientWidth,
        leadPx,
      })
      max = Math.max(0, ...rests)
      tr.style.transition = 'none'
    }

    const onStart = (e: TouchEvent) => {
      const live = liveTouches(listOf(e.touches), listOf(e.changedTouches))
      if (live.length !== 1) return cancel()
      // a new touch is a gesture of its own; only a drag's own closing click is swallowed
      suppressClickUntil = 0
      drag = { x: live[0].clientX, y: live[0].clientY, dx: 0, mode: 'undecided' }
    }
    const onMove = (e: TouchEvent) => {
      const live = liveTouches(listOf(e.touches), listOf(e.changedTouches))
      if (!drag) return
      if (live.length !== 1) return cancel()
      const dx = live[0].clientX - drag.x
      if (drag.mode === 'undecided') {
        drag.mode = decideAxis(dx, live[0].clientY - drag.y) ?? 'undecided'
        if (drag.mode === 'x') lockHorizontal()
      }
      if (drag.mode !== 'x') return
      drag.dx = dx
      tr.style.transform = translate(rubberBand(restOffset.current - dx, max))
    }
    const onEnd = (e: TouchEvent) => {
      const live = liveTouches(listOf(e.touches), listOf(e.changedTouches))
      if (!drag || live.length > 0) return
      const ended = drag
      drag = null
      if (ended.mode !== 'x') return
      suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS
      if (e.type === 'touchcancel') springBack()
      else release(from, ended.dx, rests)
    }
    const onClickCapture = (e: MouseEvent) => {
      if (Date.now() >= suppressClickUntil) return
      e.stopPropagation()
      e.preventDefault()
      suppressClickUntil = 0
    }

    vp.addEventListener('touchstart', onStart, { passive: true })
    vp.addEventListener('touchmove', onMove, { passive: true })
    vp.addEventListener('touchend', onEnd, { passive: true })
    vp.addEventListener('touchcancel', onEnd, { passive: true })
    vp.addEventListener('click', onClickCapture, { capture: true })
    return () => {
      vp.removeEventListener('touchstart', onStart)
      vp.removeEventListener('touchmove', onMove)
      vp.removeEventListener('touchend', onEnd)
      vp.removeEventListener('touchcancel', onEnd)
      vp.removeEventListener('click', onClickCapture, { capture: true })
    }
  }, [leadPx])

  return (
    <div ref={viewport} className={[styles.carousel, className].filter(Boolean).join(' ')}>
      <div
        ref={track}
        className={styles.track}
        role="listbox"
        aria-orientation="horizontal"
        style={{ paddingLeft: leadPx, paddingRight: leadPx }}
      >
        {items.map((item) => {
          const key = keyOf(item)
          const { focused, disabled, ...props } = nav.itemProps(key)
          return (
            <div
              key={key}
              className={focused ? `${styles.item} ${styles.focused}` : styles.item}
              role="option"
              aria-disabled={disabled || undefined}
              {...props}
            >
              {renderItem(item, { focused, disabled })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
