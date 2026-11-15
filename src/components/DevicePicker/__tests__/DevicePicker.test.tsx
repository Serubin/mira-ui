import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { hw, REVERSAL_GAP_MS, withRouter } from '@/__tests__/hardware'
import type { ConnectDevice } from '@/api/types'
import type { KnobStep } from '@/input/knob'
import { Layer } from '@/input/router'
import { useKnobScope } from '@/input/useKnobScope'
import { DevicePicker } from '../DevicePicker'

function device(id: string, name: string, extra: Partial<ConnectDevice> = {}): ConnectDevice {
  return {
    id,
    name,
    type: 'Speaker',
    volume: 50,
    volume_steps: 100,
    volume_disabled: false,
    is_active: false,
    is_offline: false,
    can_transfer: true,
    ...extra,
  }
}

const DEVICES = [
  device('a', 'Kitchen'),
  device('b', 'Laptop', { type: 'Computer', is_active: true }),
  device('c', 'Old TV', { is_offline: true, can_transfer: false }),
  device('d', 'Phone', { type: 'Smartphone' }),
]

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const turn = (n: number, dir: KnobStep = 1) => {
  hw.turnSteps(n, dir, { advance })
  advance(REVERSAL_GAP_MS)
}
const focused = () => document.querySelector('.focused')
const row = (name: string) => screen.getByText(name).closest('button')!

// the player's volume sits under the sheet
function Volume({ onStep }: { onStep: () => void }) {
  useKnobScope({ layer: Layer.base, enabled: true, onStep, onSelect: () => true })
  return null
}

// Back reaches the app's handler on window, which closes the sheet
function Host({
  devices,
  onSelect,
  volume,
}: {
  devices: ConnectDevice[]
  onSelect: (d: ConnectDevice) => void
  volume: () => void
}) {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <Volume onStep={volume} />
      <DevicePicker
        open={open}
        devices={devices}
        onSelect={onSelect}
        placement="modal"
        onClose={() => setOpen(false)}
      />
      <button type="button" onClick={() => setOpen(true)}>
        reopen
      </button>
    </>
  )
}

function setup(devices = DEVICES) {
  const onSelect = vi.fn()
  const volume = vi.fn()
  render(<Host devices={devices} onSelect={onSelect} volume={volume} />, { wrapper: withRouter })
  const open = () =>
    screen
      .getByRole('dialog', { hidden: true })
      .closest('[aria-hidden]')
      ?.getAttribute('aria-hidden') === 'false'
  return { onSelect, volume, open }
}

describe('DevicePicker modal', () => {
  it('marks the playing device and starts the knob on it', () => {
    setup()
    expect(row('Laptop')).toHaveAttribute('aria-current', 'true')
    expect(row('Laptop')).toHaveTextContent('Playing')
    expect(row('Kitchen')).not.toHaveAttribute('aria-current')
    expect(focused()).toBe(row('Laptop'))
  })

  it('turning moves between devices and pressing transfers to the focused one', () => {
    const { onSelect, volume } = setup()
    turn(2)
    expect(focused()).toBe(row('Phone'))
    hw.press()
    expect(onSelect).toHaveBeenCalledWith(DEVICES[3])
    expect(volume).not.toHaveBeenCalled()
  })

  it('an offline device takes focus but a press does nothing', () => {
    const { onSelect } = setup()
    turn(1)
    expect(focused()).toBe(row('Old TV'))
    expect(row('Old TV')).toHaveTextContent('Offline')
    hw.press()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('a tap still transfers', () => {
    const { onSelect } = setup()
    fireEvent.click(row('Kitchen'))
    expect(onSelect).toHaveBeenCalledWith(DEVICES[0])
  })

  it('focuses a device whose id is not a valid selector', () => {
    setup([device('a"b\\', 'Odd id'), device('c', 'Kitchen', { is_active: true })])
    turn(1, -1)
    expect(focused()).toBe(row('Odd id'))
  })

  it('shows the empty state and keeps the knob off the volume', () => {
    const { volume } = setup([])
    expect(screen.getByText('No active devices to select from for playback')).toBeInTheDocument()
    turn(2)
    expect(volume).not.toHaveBeenCalled()
  })

  it('Back closes, and a reopen starts on the playing device again', () => {
    const { open } = setup()
    turn(2)
    hw.back()
    expect(open()).toBe(false)
    fireEvent.click(screen.getByText('reopen'))
    expect(open()).toBe(true)
    expect(focused()).toBe(row('Laptop'))
  })
})
