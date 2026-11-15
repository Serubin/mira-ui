import { useEffect, useEffectEvent } from 'react'

/**
 * While `enabled`, Back runs `onBack` and goes no further. It listens in the capture phase, so
 * a sheet can step out of a sub-view before the app's Back handler closes the whole overlay.
 */
export function useBackCapture(enabled: boolean, onBack: () => void) {
  const run = useEffectEvent(onBack)
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      run()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [enabled])
}
