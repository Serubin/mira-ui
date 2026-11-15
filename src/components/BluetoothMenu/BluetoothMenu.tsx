import { memo, useEffect, useRef, useState } from 'react'
import * as bt from '@/api/bluetooth'
import { subscribeEvents } from '@/api/eventBus'
import type { DevicePairedPayload, KnownBluetoothDevice } from '@/api/types'
import { BT_DEVICE_NAME } from '@/brand'
import {
  MenuControl,
  MenuGrid,
  MenuLink,
  MenuSheet,
  MenuTile,
  useRowInView,
} from '@/components/Menu'
import { useKnownDevices } from '@/hooks/useKnownDevices'
import { Layer } from '@/input/router'
import { useBackCapture } from '@/input/useBackCapture'
import { useKnobNav } from '@/input/useKnobNav'
import { useNotify } from '@/notify/notifyContext'
import { accentVar, useTheme } from '@/theme/theme'
import { Icon } from '@/ui/icons'
import styles from './BluetoothMenu.module.scss'

interface Props {
  open: boolean
  online: boolean | null
  onClose: () => void
}

const FORGET_ARM_MS = 3500
const PAIR = 'pair'

type View = { kind: 'list' } | { kind: 'phone' | 'forget'; address: string }
type PhoneAction = 'connect' | 'star' | 'forget'
const PHONE_ACTIONS: readonly PhoneAction[] = ['connect', 'star', 'forget']
type ConfirmItem = 'confirm' | 'cancel'
const CONFIRM: readonly ConfirmItem[] = ['confirm', 'cancel']
const LIST: View = { kind: 'list' }

// Bluetooth pairing menu
// priority list, forget, tap to connect, pair new device
function BluetoothMenuImpl({ open, online, onClose }: Props) {
  const theme = useTheme()
  const notify = useNotify()
  const { devices, refresh } = useKnownDevices(open)
  const [armedForget, setArmedForget] = useState<string | null>(null)
  const [pairMode, setPairMode] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // the knob's per-phone views; touch acts on the list rows directly
  const [view, setView] = useState<View>(LIST)

  useEffect(() => {
    if (!armedForget) return
    const t = window.setTimeout(() => setArmedForget(null), FORGET_ARM_MS)
    return () => window.clearTimeout(t)
  }, [armedForget])

  // pair mode sets discoverable on
  const pairModeRef = useRef(pairMode)
  const onlineRef = useRef(online)
  useEffect(() => {
    pairModeRef.current = pairMode
    onlineRef.current = online
  })

  // closing or unmounting ends pair mode
  useEffect(() => {
    if (!open) return
    return () => {
      if (pairModeRef.current && onlineRef.current === true) {
        bt.setDiscoverable(false).catch(() => {})
      }
    }
  }, [open])

  useEffect(() => {
    if (!pairMode || !open) return
    const id = window.setInterval(() => {
      bt.setDiscoverable(true).catch(() => {})
    }, 3000)
    return () => window.clearInterval(id)
  }, [pairMode, open])

  // a successful pair completes pair mode
  useEffect(() => {
    if (!open) return
    return subscribeEvents((evt) => {
      if (evt.type !== 'bluetooth/paired' || !pairModeRef.current) return
      const p = evt.data as DevicePairedPayload
      const label = p?.device?.alias || p?.device?.name || p?.device?.address
      notify(label ? `Paired ${label}` : 'Paired', { variant: 'success', icon: 'bluetooth' })
      setPairMode(false)
      if (onlineRef.current === true) {
        bt.setDiscoverable(false).catch(() => {})
      }
    })
  }, [notify, open])

  const onPairNew = () => {
    bt.setDiscoverable(true)
      .then(() => setPairMode(true))
      .catch(() => notify("Couldn't enable pairing", { variant: 'error' }))
  }

  const onToggleStar = (d: KnownBluetoothDevice) => {
    setArmedForget(null)
    bt.starDevice(d.address, !d.starred)
      .then(refresh)
      .catch(() => notify("Couldn't update priority", { variant: 'error' }))
  }

  // dontt let the user delete the only bt device
  const wouldStrand = (d: KnownBluetoothDevice) =>
    (devices?.length ?? 0) === 1 && (online !== true || d.network)

  const warnStrand = () => {
    setArmedForget(null)
    notify(
      "That's your only connection! Plug in over USB or pair another phone before removing it",
      { variant: 'warning' },
    )
  }

  const forget = (d: KnownBluetoothDevice) => {
    setArmedForget(null)
    setBusy(d.address)
    bt.forgetDevice(d.address)
      .then(() => {
        notify(`Removed ${deviceLabel(d)}`, { variant: 'info', icon: 'bluetooth' })
        refresh()
      })
      .catch(() => notify(`Couldn't remove ${deviceLabel(d)}`, { variant: 'error' }))
      .finally(() => setBusy(null))
  }

  const onForget = (d: KnownBluetoothDevice) => {
    if (wouldStrand(d)) {
      warnStrand()
      return
    }
    if (armedForget !== d.address) {
      setArmedForget(d.address)
      return
    }
    forget(d)
  }

  // a device is set when it carries the active PAN and we are online
  const isSettled = (d: KnownBluetoothDevice) => d.network && online !== false

  const onConnect = (d: KnownBluetoothDevice) => {
    setArmedForget(null)
    if (isSettled(d)) return
    notify(`Connecting to ${deviceLabel(d)}...`, { variant: 'info', icon: 'bluetooth' })
    bt.connectKnownDevice(d.address).catch(() =>
      notify(`Couldn't connect to ${deviceLabel(d)}`, { variant: 'error' }),
    )
  }

  const known = devices ?? []
  const phone = view.kind === 'list' ? undefined : known.find((d) => d.address === view.address)

  // nothing until the first load, so focus starts on the first phone rather than following Pair
  const listKeys =
    devices === null ? [] : [...known.map((d) => d.address), ...(pairMode ? [] : [PAIR])]
  const list = useKnobNav({
    keys: listKeys,
    onSelect: (key) => {
      if (key === PAIR) {
        onPairNew()
        return
      }
      setArmedForget(null)
      const d = known.find((k) => k.address === key)
      if (!d) return
      setView({ kind: 'phone', address: d.address })
      actions.setFocus(isSettled(d) ? 'star' : 'connect')
    },
    enabled: open && view.kind === 'list',
    layer: Layer.modal,
  })

  const actions = useKnobNav({
    keys: PHONE_ACTIONS,
    onSelect: (action) => {
      if (!phone) return
      if (action === 'connect') {
        onConnect(phone)
        setView(LIST)
      } else if (action === 'star') {
        onToggleStar(phone)
      } else if (wouldStrand(phone)) {
        warnStrand()
      } else {
        setView({ kind: 'forget', address: phone.address })
        // the safe choice is under the knob first
        confirm.setFocus('cancel')
      }
    },
    disabled: (action) =>
      !phone ||
      (action === 'connect' && isSettled(phone)) ||
      (action === 'forget' && busy === phone.address),
    enabled: open && view.kind === 'phone',
    layer: Layer.modal,
  })

  const confirm = useKnobNav({
    keys: CONFIRM,
    onSelect: (item) => {
      if (!phone) return
      if (item === 'cancel') {
        setView({ kind: 'phone', address: phone.address })
        return
      }
      // the list can change while this view is up, so the strand guard runs again
      if (wouldStrand(phone)) {
        warnStrand()
        setView({ kind: 'phone', address: phone.address })
        return
      }
      forget(phone)
      setView(LIST)
    },
    disabled: (item) => item === 'confirm' && busy === phone?.address,
    enabled: open && view.kind === 'forget',
    layer: Layer.modal,
  })

  // Back steps out of a phone's views before the overlay stack gets to close the sheet
  const stepBack = () => {
    if (view.kind === 'forget') {
      setView({ kind: 'phone', address: view.address })
    } else if (view.kind === 'phone') {
      setView(LIST)
      list.setFocus(view.address)
    }
  }
  useBackCapture(open && view.kind !== 'list', stepBack)

  // every open starts on the list. a close drops pair mode, as unmounting used to
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    setView(LIST)
    setArmedForget(null)
    setPairMode(false)
    if (open && listKeys.length > 0) list.setFocus(listKeys[0])
  }

  // the phone was forgotten or unpaired under the knob
  if (view.kind !== 'list' && devices !== null && !phone) setView(LIST)

  const body = useRowInView(view.kind === 'list' ? list.focusKey : undefined, open)

  const title =
    view.kind === 'phone' && phone
      ? deviceLabel(phone)
      : view.kind === 'forget' && phone
        ? `Remove ${deviceLabel(phone)}?`
        : 'Bluetooth pairing'

  return (
    <MenuSheet open={open} onClose={onClose} title={title} style={accentVar(theme)} bodyRef={body}>
      {view.kind === 'forget' && phone ? (
        <div key="forget" className={styles.view}>
          <p className={styles.note}>
            To use it here again, you'll need to pair it again from the phone.
          </p>
          <MenuGrid columns={2}>
            <MenuTile
              icon="trash"
              label="Remove"
              detail="Forget phone"
              tone="danger"
              {...confirm.itemProps('confirm')}
            />
            <MenuTile
              icon="close"
              label="Cancel"
              detail="Keep it"
              {...confirm.itemProps('cancel')}
            />
          </MenuGrid>
        </div>
      ) : view.kind === 'phone' && phone ? (
        <div key="phone" className={styles.view}>
          <p className={styles.note}>{phoneState(phone, isSettled(phone))}</p>
          <MenuGrid columns={3}>
            <MenuTile
              icon="bluetooth"
              label="Connect"
              detail={isSettled(phone) ? 'In use' : 'Use this phone'}
              {...actions.itemProps('connect')}
            />
            <MenuTile
              icon={phone.starred ? 'starFilled' : 'star'}
              label="Priority"
              on={phone.starred}
              {...actions.itemProps('star')}
            />
            <MenuTile
              icon="trash"
              label="Remove"
              detail="Forget phone"
              tone="danger"
              {...actions.itemProps('forget')}
            />
          </MenuGrid>
        </div>
      ) : (
        <div key="list" className={styles.view}>
          {devices !== null && devices.length === 0 ? (
            <div className={styles.empty}>
              <div>No phones paired yet.</div>
              <div className={styles.emptySub}>
                If a phone you removed won't pair again, also remove "{BT_DEVICE_NAME}" from that
                phone's Bluetooth settings, then try again.
              </div>
            </div>
          ) : (
            known.map((d) => (
              <div key={d.address} data-row={d.address}>
                <PhoneRow
                  phone={d}
                  settled={isSettled(d)}
                  focused={list.focusKey === d.address}
                  armed={armedForget === d.address}
                  busy={busy === d.address}
                  onTouch={() => list.setFocus(d.address)}
                  onStar={() => onToggleStar(d)}
                  onConnect={() => onConnect(d)}
                  onForget={() => onForget(d)}
                />
              </div>
            ))
          )}

          {pairMode ? (
            <div className={styles.pairHint}>
              <span className={styles.pulseDot} aria-hidden />
              Discoverable as "{BT_DEVICE_NAME}" pair from your phone's Bluetooth settings
            </div>
          ) : (
            <div data-row={PAIR}>
              <MenuLink
                icon="plus"
                label="Pair new device"
                chevron={false}
                {...list.itemProps(PAIR)}
              />
            </div>
          )}
        </div>
      )}
    </MenuSheet>
  )
}

interface PhoneRowProps {
  phone: KnownBluetoothDevice
  /** carrying the active internet connection */
  settled: boolean
  focused: boolean
  /** the first tap on remove, waiting for the second */
  armed: boolean
  busy: boolean
  onTouch: () => void
  onStar: () => void
  onConnect: () => void
  onForget: () => void
}

/** A phone in the list, with touch controls for priority, connecting and removing. */
function PhoneRow({
  phone: d,
  settled,
  focused,
  armed,
  busy,
  onTouch,
  onStar,
  onConnect,
  onForget,
}: PhoneRowProps) {
  const stateClass = settled ? styles.stateOn : d.connected ? styles.stateWarn : ''
  const state = settled
    ? 'Connected'
    : d.connected
      ? 'Connected with no internet · tap to use'
      : 'Tap to connect'
  return (
    <MenuControl focused={focused} onPointerDownCapture={onTouch}>
      <div className={styles.row}>
        <button
          type="button"
          className={`${styles.iconBtn} ${d.starred ? styles.starOn : ''}`}
          aria-label={d.starred ? 'Remove priority' : 'Make priority'}
          aria-pressed={d.starred}
          onClick={onStar}
        >
          <Icon name={d.starred ? 'starFilled' : 'star'} size={22} />
        </button>

        <div
          className={`${styles.info} ${settled ? '' : styles.connectable}`}
          role={settled ? undefined : 'button'}
          tabIndex={settled ? undefined : 0}
          onClick={onConnect}
        >
          <span className={styles.name}>{deviceLabel(d)}</span>
          <span className={`${styles.state} ${stateClass}`}>{state}</span>
        </div>

        <button
          type="button"
          className={`${styles.iconBtn} ${styles.forgetBtn} ${armed ? styles.forgetArmed : ''}`}
          aria-label={armed ? 'Tap again to remove' : 'Remove device'}
          disabled={busy}
          onClick={onForget}
        >
          {armed ? (
            <span className={styles.forgetConfirm}>Remove?</span>
          ) : (
            <Icon name="trash" size={20} />
          )}
        </button>
      </div>
    </MenuControl>
  )
}

function phoneState(d: KnownBluetoothDevice, settled: boolean): string {
  if (settled) return 'Connected, and sharing its internet.'
  if (d.connected) return 'Connected, with no internet.'
  return 'Not connected.'
}

function deviceLabel(d: KnownBluetoothDevice): string {
  return d.name || d.address
}

export const BluetoothMenu = memo(BluetoothMenuImpl)
