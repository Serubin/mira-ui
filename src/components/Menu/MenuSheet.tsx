import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEventHandler,
  type ReactNode,
  type RefObject,
} from 'react'
import type { KnobItemProps } from '@/input/useKnobNav'
import { Icon, type IconName } from '@/ui/icons'
import styles from './MenuSheet.module.scss'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  edge?: 'top' | 'bottom'
  style?: CSSProperties
  /** the scrolling body, for keeping a knob-focused row in view */
  bodyRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}

export function MenuSheet({
  open,
  onClose,
  title,
  edge = 'bottom',
  style,
  bodyRef,
  children,
}: SheetProps) {
  const ownBody = useRef<HTMLDivElement | null>(null)
  const scroller = bodyRef ?? ownBody
  const [more, setMore] = useState({ above: false, below: false })
  const checkMore = () => {
    const el = scroller.current
    if (!el) return
    const above = el.scrollTop > 4
    const below = el.scrollHeight - el.scrollTop - el.clientHeight > 4
    setMore((m) => (m.above === above && m.below === below ? m : { above, below }))
  }
  const recheck = useEffectEvent(checkMore)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!open || !el) return
    const id = requestAnimationFrame(() => recheck())
    // content and the display size both change the overflow without a scroll
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => recheck())
    ro?.observe(el)
    if (el.firstElementChild) ro?.observe(el.firstElementChild)
    return () => {
      cancelAnimationFrame(id)
      ro?.disconnect()
    }
  }, [open, scroller])

  return (
    <div
      className={`${styles.root} ${edge === 'top' ? styles.top : ''} ${open ? styles.open : ''}`}
      aria-hidden={!open}
      onClick={onClose}
    >
      <div
        className={styles.sheet}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.bodyWrap}>
          <div ref={scroller} className={styles.body} onScroll={checkMore}>
            <div className={styles.content}>{children}</div>
          </div>
          <div
            className={`${styles.more} ${styles.moreAbove} ${more.above ? styles.moreShown : ''}`}
            aria-hidden
          >
            <Icon name="chevronRight" size={20} />
          </div>
          <div
            className={`${styles.more} ${styles.moreBelow} ${more.below ? styles.moreShown : ''}`}
            aria-hidden
          >
            <Icon name="chevronRight" size={20} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function MenuGrid({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <div
      className={styles.grid}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  )
}

type Tone = 'danger' | 'support'

interface TileProps extends KnobItemProps {
  icon: IconName
  label: string
  /** a toggle (`on` set) shows On or Off here instead */
  detail?: string
  on?: boolean
  tone?: Tone
}

export function MenuTile({ icon, label, detail, on, tone, focused, disabled, onClick }: TileProps) {
  const toggle = on !== undefined
  const value = toggle ? (on ? 'On' : 'Off') : detail
  return (
    <button
      type="button"
      role={toggle ? 'switch' : undefined}
      aria-checked={toggle ? on : undefined}
      className={`${styles.tile} ${on ? styles.on : ''} ${tone ? styles[tone] : ''} ${focused ? styles.focused : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={styles.tileIcon}>
        <Icon name={icon} />
      </span>
      <span className={styles.tileLabel}>{label}</span>
      {value ? <span className={styles.tileValue}>{value}</span> : null}
    </button>
  )
}

interface LinkProps extends KnobItemProps {
  icon: IconName
  label: string
  detail?: string
  tone?: Tone
}

export function MenuLink({ icon, label, detail, tone, focused, disabled, onClick }: LinkProps) {
  return (
    <button
      type="button"
      className={`${styles.link} ${tone ? styles[tone] : ''} ${focused ? styles.focused : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={styles.linkIcon}>
        <Icon name={icon} />
      </span>
      <span className={styles.linkText}>
        <span className={styles.linkLabel}>{label}</span>
        {detail ? <span className={styles.linkDetail}>{detail}</span> : null}
      </span>
      <span className={styles.chevron}>
        <Icon name="chevronRight" size={20} />
      </span>
    </button>
  )
}

interface ControlProps {
  focused: boolean
  /** the knob is adjusting this row's control */
  active?: boolean
  onPointerDownCapture?: PointerEventHandler<HTMLDivElement>
  children: ReactNode
}

/** A `menu-button` frame for a row that holds its own controls, such as a slider. */
export function MenuControl({ focused, active, onPointerDownCapture, children }: ControlProps) {
  return (
    <div
      className={`${styles.control} ${active ? styles.on : ''} ${focused ? styles.focused : ''}`}
      aria-selected={focused}
      onPointerDownCapture={onPointerDownCapture}
    >
      {children}
    </div>
  )
}
