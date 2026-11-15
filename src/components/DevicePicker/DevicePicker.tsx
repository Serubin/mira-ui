import { memo, useMemo, useState } from 'react'
import type { ConnectDevice } from '@/api/types'
import { MenuLink, MenuSheet, useRowInView } from '@/components/Menu'
import { Layer } from '@/input/router'
import { useKnobNav } from '@/input/useKnobNav'
import { accentVar, useTheme } from '@/theme/theme'
import { Icon, deviceIconName } from '@/ui/icons'
import styles from './DevicePicker.module.scss'

interface Props {
  devices: ConnectDevice[]
  onSelect?: (device: ConnectDevice) => void
  placement?: 'inline' | 'modal'
  /** the modal sheet's visibility; the inline card is always shown */
  open?: boolean
  onClose?: () => void
}

const EMPTY = 'No active devices to select from for playback'
const noop = () => {}

function deviceDetail(d: ConnectDevice): string | undefined {
  if (d.is_active) return 'Playing'
  if (d.is_offline) return 'Offline'
  return undefined
}

function DeviceList({
  devices,
  onSelect,
}: {
  devices: ConnectDevice[]
  onSelect?: (d: ConnectDevice) => void
}) {
  return (
    <ul className={styles.list}>
      {devices.map((d) => {
        const interactive = Boolean(onSelect) && d.can_transfer && !d.is_offline
        return (
          <li key={d.id}>
            <div
              className={`${styles.row} ${d.is_active ? styles.active : ''} ${
                interactive ? styles.interactive : ''
              }`}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={interactive ? () => onSelect?.(d) : undefined}
            >
              <span className={styles.icon}>
                <Icon name={deviceIconName(d.type)} size={22} />
              </span>
              <span className={styles.name}>{d.name}</span>
              {d.is_active ? <span className={styles.activeDot} aria-label="active" /> : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function DeviceSheet({
  open,
  devices,
  onSelect,
  onClose,
}: {
  open: boolean
  devices: ConnectDevice[]
  onSelect?: (d: ConnectDevice) => void
  onClose: () => void
}) {
  const theme = useTheme()
  const ids = useMemo(() => devices.map((d) => d.id), [devices])
  const find = (id: string) => devices.find((d) => d.id === id)
  const current = devices.find((d) => d.is_active)?.id
  const nav = useKnobNav({
    keys: ids,
    defaultKey: current,
    onSelect: (id) => {
      const d = find(id)
      if (d) onSelect?.(d)
    },
    disabled: (id) => {
      const d = find(id)
      return !onSelect || !d || !d.can_transfer || d.is_offline
    },
    enabled: open,
    layer: Layer.modal,
  })

  // every open starts on the device that is playing
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) nav.setFocus(current ?? ids[0])
  }

  const body = useRowInView(nav.focusKey, open)

  return (
    <MenuSheet
      open={open}
      onClose={onClose}
      title="Devices"
      style={accentVar(theme)}
      bodyRef={body}
    >
      {devices.length === 0 ? (
        <p className={styles.note}>{EMPTY}</p>
      ) : (
        devices.map((d) => (
          <div key={d.id} data-row={d.id}>
            <MenuLink
              icon={deviceIconName(d.type)}
              label={d.name}
              detail={deviceDetail(d)}
              on={d.is_active}
              chevron={false}
              {...nav.itemProps(d.id)}
            />
          </div>
        ))
      )}
    </MenuSheet>
  )
}

function DevicePickerImpl({
  devices,
  onSelect,
  placement = 'inline',
  open = true,
  onClose,
}: Props) {
  if (placement === 'modal') {
    return (
      <DeviceSheet open={open} devices={devices} onSelect={onSelect} onClose={onClose ?? noop} />
    )
  }

  // always render the box even if no items
  return (
    <div className={styles.cardInline}>
      <div className={styles.header}>Devices</div>
      {devices.length === 0 ? (
        <div className={styles.empty}>{EMPTY}</div>
      ) : (
        <DeviceList devices={devices} onSelect={onSelect} />
      )}
    </div>
  )
}

export const DevicePicker = memo(DevicePickerImpl)
