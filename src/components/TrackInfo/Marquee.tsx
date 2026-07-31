import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUiScale } from '@/uiScale'
import styles from './Marquee.module.scss'

// TODO: fine tune the speed for sliding

interface Props {
  text: string
  className?: string
}

const SLIDE_PX_PER_SEC = 35
const SLIDE_PHASE_RATIO = 0.32

function MarqueeImpl({ text, className }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [animate, setAnimate] = useState(false)
  // NoLyricsView's container is a shrinkable percentage width, so the overflow distance
  // measured below changes with the display size
  const uiScale = useUiScale()

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    const inner = innerRef.current
    if (!wrap || !inner) return

    wrap.style.removeProperty('--marquee-distance')
    wrap.style.removeProperty('--marquee-duration')

    const overflow = inner.offsetWidth - wrap.clientWidth
    if (overflow > 4) {
      const duration = Math.max(6, overflow / (SLIDE_PX_PER_SEC * SLIDE_PHASE_RATIO))
      // dir="auto" below flips the inner element to RTL for Hebrew/Arabic text, where the overflow
      // hangs off the left edge instead of the right. Scrolling by a negative offset would then
      // drag the text further away from its start, so the sign has to follow the resolved
      // direction rather than being hardcoded.
      const rtl = window.getComputedStyle(inner).direction === 'rtl'
      const distance = rtl ? overflow : -overflow
      wrap.style.setProperty('--marquee-distance', `${distance}px`)
      wrap.style.setProperty('--marquee-duration', `${duration.toFixed(1)}s`)
      setAnimate(true)
    } else {
      setAnimate(false)
    }
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure, text, uiScale])

  // Script fonts load asynchronously and with font-display: swap, so the first measurement above
  // runs against fallback metrics. Without re-measuring once the real face arrives, a non-Latin
  // title is sized from the wrong font and either fails to scroll or scrolls the wrong distance.
  useEffect(() => {
    const fonts = document.fonts
    if (typeof fonts?.ready?.then !== 'function') return
    let cancelled = false
    void fonts.ready.then(() => {
      if (!cancelled) measure()
    })
    return () => {
      cancelled = true
    }
  }, [measure, text, uiScale])

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${animate ? styles.animating : ''} ${className ?? ''}`}
    >
      <div ref={innerRef} className={styles.inner} dir="auto">
        {text}
      </div>
    </div>
  )
}

export const Marquee = memo(MarqueeImpl)
