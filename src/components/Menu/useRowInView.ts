import { useLayoutEffect, useRef } from 'react'
import { ensureVisible } from '@/ui/List/listMath'

/**
 * A `MenuSheet` `bodyRef` that keeps the `[data-row]` element named `row` scrolled into view
 * while `open`. `layout` is any value whose change moves the rows, such as the display size.
 */
export function useRowInView(row: string | undefined, open: boolean, layout?: unknown) {
  const body = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = body.current
    if (!open || !el || row === undefined) return
    // matched by value, so a key needs no selector escaping
    const target = Array.from(el.querySelectorAll<HTMLElement>('[data-row]')).find(
      (r) => r.dataset.row === row,
    )
    if (!target) return
    // offsets and scrollTop share the unzoomed layout px of #root's zoom
    el.scrollTop = ensureVisible(
      el.scrollTop,
      el.clientHeight,
      target.offsetTop,
      target.offsetHeight,
      16,
    )
  }, [row, open, layout])
  return body
}
