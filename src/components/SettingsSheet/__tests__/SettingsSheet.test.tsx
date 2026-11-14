import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { hw, REVERSAL_GAP_MS, withRouter } from '@/__tests__/hardware'
import type { KnobStep } from '@/input/knob'
import { Layer } from '@/input/router'
import { useKnobScope } from '@/input/useKnobScope'
import { SettingsSheet } from '../SettingsSheet'
import { __resetSettings, getSettings, updateSettings } from '@/settings'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  __resetSettings()
})

afterEach(() => {
  vi.useRealTimers()
})

// jsdom gives every element a zero-sized rect and no pointer capture, so the drag
// handlers need both patched (same approach as ProgressBar.test.tsx)
function stubBar(el: HTMLElement, left = 100, width = 300): void {
  el.getBoundingClientRect = () =>
    ({
      left,
      width,
      right: left + width,
      top: 0,
      bottom: 40,
      height: 40,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
  el.setPointerCapture = () => undefined
  el.releasePointerCapture = () => undefined
  el.hasPointerCapture = () => false
}

describe('SettingsSheet display size', () => {
  it('shows the stored scale', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Display size' })
    expect(slider).toHaveAttribute('aria-valuenow', '100')
    expect(slider).toHaveAttribute('aria-valuemin', '85')
    expect(slider).toHaveAttribute('aria-valuemax', '115')
  })

  it('applies immediately when stepped', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Display size up' }))
    expect(getSettings().uiScalePct).toBe(105)
  })

  // the whole point of commit-on-release: applying mid-drag moves this panel under the
  // finger and oscillates between notches
  it('previews during a drag but only commits on release', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Display size' })
    stubBar(slider)

    fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '115')
    expect(getSettings().uiScalePct).toBe(100)

    fireEvent.pointerMove(slider, { clientX: 250, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '100')
    expect(getSettings().uiScalePct).toBe(100)

    fireEvent.pointerUp(slider, { clientX: 250, pointerId: 1 })
    expect(getSettings().uiScalePct).toBe(100)

    fireEvent.pointerDown(slider, { clientX: 340, pointerId: 2 })
    fireEvent.pointerUp(slider, { clientX: 340, pointerId: 2 })
    expect(getSettings().uiScalePct).toBe(110)
    // without this a stuck preview would be invisible: the store is right but the row
    // would keep rendering the old drag value
    expect(slider).toHaveAttribute('aria-valuenow', '110')
  })

  it('abandons the drag on pointercancel instead of committing it', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Display size' })
    stubBar(slider)

    fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '115')
    fireEvent.pointerCancel(slider, { clientX: 400, pointerId: 1 })

    expect(getSettings().uiScalePct).toBe(100)
    expect(slider).toHaveAttribute('aria-valuenow', '100')
  })

  it('drops the gesture when the sheet is dismissed mid-drag', () => {
    const { rerender } = render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Display size' })
    stubBar(slider)

    fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '115')

    // pointer capture keeps delivering events to a sheet that is no longer open
    rerender(<SettingsSheet open={false} onClose={vi.fn()} />)
    fireEvent.pointerUp(slider, { clientX: 400, pointerId: 1 })

    expect(getSettings().uiScalePct).toBe(100)
  })

  it('does not stay armed when capture is lost without a pointerup', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Display size' })
    stubBar(slider)

    fireEvent.pointerDown(slider, { clientX: 250, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '100')
    // no pointerup ever arrives; without disarming here the drag flag would survive and
    // a later bare pointermove would drag the slider with no finger down
    fireEvent.lostPointerCapture(slider, { pointerId: 1 })
    fireEvent.pointerMove(slider, { clientX: 130, pointerId: 2 })

    expect(slider).toHaveAttribute('aria-valuenow', '100')
  })

  it('keeps the display size preview out of the other rows', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const volume = screen.getByRole('slider', { name: 'Volume per turn' })
    stubBar(volume)
    fireEvent.pointerDown(volume, { clientX: 250, pointerId: 1 })
    fireEvent.pointerUp(volume, { clientX: 250, pointerId: 1 })

    expect(screen.getByRole('slider', { name: 'Display size' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
  })

  it('does not commit on release for the other sliders', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Volume per turn' })
    stubBar(slider)
    fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
    // no onCommit passed, so onChange alone drives it and it applies live
    expect(getSettings().volumeStepPct).toBe(10)
  })
})

describe('SettingsSheet bluetooth', () => {
  it('opens bluetooth pairing from its row', () => {
    const onOpenBluetooth = vi.fn()
    render(<SettingsSheet open onClose={vi.fn()} onOpenBluetooth={onOpenBluetooth} />)
    fireEvent.click(screen.getByText('Bluetooth pairing'))
    expect(onOpenBluetooth).toHaveBeenCalledTimes(1)
  })
})

describe('SettingsSheet with the knob', () => {
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
  const turn = (n: number, dir: KnobStep = 1) => {
    hw.turnSteps(n, dir, { advance })
    advance(REVERSAL_GAP_MS)
  }
  const focused = () => document.querySelector('.focused')
  const slider = (name: string) => screen.getByRole('slider', { name })

  // the player's volume sits under the sheet
  function Volume({ onStep }: { onStep: () => void }) {
    useKnobScope({ layer: Layer.base, enabled: true, onStep, onSelect: () => true })
    return null
  }

  // Back reaches the app's handler on window, which closes the sheet
  function Host({
    onOpenBluetooth,
    phoneVolume,
    volume,
  }: {
    onOpenBluetooth?: () => void
    phoneVolume?: boolean
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
        <SettingsSheet
          open={open}
          onClose={() => setOpen(false)}
          phoneVolume={phoneVolume}
          onOpenBluetooth={onOpenBluetooth}
        />
        <button type="button" onClick={() => setOpen(true)}>
          reopen
        </button>
      </>
    )
  }

  function setup(props: { phoneVolume?: boolean } = {}) {
    const onOpenBluetooth = vi.fn()
    const volume = vi.fn()
    render(<Host {...props} onOpenBluetooth={onOpenBluetooth} volume={volume} />, {
      wrapper: withRouter,
    })
    const isOpen = () => screen.getByRole('dialog', { hidden: true }).closest('[aria-hidden]')
    return {
      onOpenBluetooth,
      volume,
      open: () => isOpen()?.getAttribute('aria-hidden') === 'false',
    }
  }

  it('walks the rows in order, auto brightness before its slider', () => {
    const { onOpenBluetooth, volume } = setup()
    expect(focused()).toContainElement(slider('Display size'))
    turn(1)
    expect(focused()).toContainElement(slider('Lyric sync offset'))
    turn(1)
    expect(focused()).toContainElement(slider('Volume per turn'))
    turn(1)
    expect(focused()).toBe(screen.getByRole('switch', { name: 'Auto brightness' }))
    turn(1)
    expect(focused()).toContainElement(slider('Brightness'))
    turn(1)
    expect(focused()).toHaveTextContent('Bluetooth pairing')
    hw.press()
    expect(onOpenBluetooth).toHaveBeenCalledTimes(1)
    expect(volume).not.toHaveBeenCalled()
  })

  it('adjusts a slider one notch per step until pressed', () => {
    setup()
    turn(1)
    hw.press()
    turn(2)
    expect(getSettings().lyricOffsetMs).toBe(100)
    turn(1, -1)
    expect(getSettings().lyricOffsetMs).toBe(50)
    expect(focused()).toContainElement(slider('Lyric sync offset'))

    hw.press()
    turn(1)
    expect(getSettings().lyricOffsetMs).toBe(50)
    expect(focused()).toContainElement(slider('Volume per turn'))
  })

  it('stops at the ends of a slider', () => {
    setup()
    turn(1)
    hw.press()
    turn(15)
    expect(getSettings().lyricOffsetMs).toBe(500)
  })

  it('commits display size only when leaving adjust mode', () => {
    setup()
    hw.press()
    turn(1)
    expect(slider('Display size')).toHaveAttribute('aria-valuenow', '105')
    expect(getSettings().uiScalePct).toBe(100)
    turn(1)
    expect(getSettings().uiScalePct).toBe(100)

    hw.press()
    expect(getSettings().uiScalePct).toBe(110)
    expect(slider('Display size')).toHaveAttribute('aria-valuenow', '110')
  })

  it('Back leaves adjust mode, committing display size, and a second Back closes', () => {
    const { open } = setup()
    hw.press()
    turn(1)
    hw.back()
    expect(open()).toBe(true)
    expect(getSettings().uiScalePct).toBe(105)
    // the knob moves focus again
    turn(1)
    expect(focused()).toContainElement(slider('Lyric sync offset'))

    hw.back()
    expect(open()).toBe(false)
  })

  it('Back closes the sheet when nothing is being adjusted', () => {
    const { open } = setup()
    hw.back()
    expect(open()).toBe(false)
  })

  it('drops an unfinished display size when dismissed, and reopens at the top', () => {
    const { open } = setup()
    hw.press()
    turn(1)
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(open()).toBe(false)
    expect(getSettings().uiScalePct).toBe(100)

    fireEvent.click(screen.getByText('reopen'))
    expect(slider('Display size')).toHaveAttribute('aria-valuenow', '100')
    expect(focused()).toContainElement(slider('Display size'))
    // not still adjusting: the knob moves focus
    turn(1)
    expect(focused()).toContainElement(slider('Lyric sync offset'))
  })

  it('toggles auto brightness on a press, and only then lets the slider adjust', () => {
    setup()
    turn(3)
    hw.press()
    expect(getSettings().autoBrightness).toBe(false)
    turn(1)
    hw.press()
    turn(2)
    expect(getSettings().brightness).toBe(7)
    hw.press()
  })

  it('does not adjust the brightness slider while auto owns it', () => {
    setup()
    turn(4)
    hw.press()
    turn(1)
    expect(getSettings().brightness).toBe(5)
    expect(focused()).toHaveTextContent('Bluetooth pairing')
  })

  it('does not adjust volume per turn while the phone owns volume', () => {
    setup({ phoneVolume: true })
    turn(2)
    hw.press()
    turn(1)
    expect(getSettings().volumeStepPct).toBe(2)
    expect(focused()).toBe(screen.getByRole('switch', { name: 'Auto brightness' }))
  })

  it('leaves adjust mode when auto brightness takes the slider', () => {
    setup()
    act(() => updateSettings({ autoBrightness: false }))
    turn(4)
    hw.press()
    act(() => updateSettings({ autoBrightness: true }))
    turn(1)
    expect(getSettings().brightness).toBe(5)
    expect(focused()).toHaveTextContent('Bluetooth pairing')
  })

  // committing the previewed size would rescale the panel under the finger
  it('a touch on another row abandons the adjustment and moves focus there', () => {
    setup()
    hw.press()
    turn(1)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Volume per turn up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Volume per turn up' }))
    expect(getSettings().uiScalePct).toBe(100)
    expect(slider('Display size')).toHaveAttribute('aria-valuenow', '100')
    expect(getSettings().volumeStepPct).toBe(3)
    expect(focused()).toContainElement(slider('Volume per turn'))
    turn(1)
    expect(focused()).toBe(screen.getByRole('switch', { name: 'Auto brightness' }))
  })

  it('a tap on Bluetooth pairing opens it even while a slider is being adjusted', () => {
    const { onOpenBluetooth } = setup()
    turn(1)
    hw.press()
    const row = screen.getByText('Bluetooth pairing')
    fireEvent.pointerDown(row)
    fireEvent.click(row)
    expect(onOpenBluetooth).toHaveBeenCalledTimes(1)
  })

  it('a tap on the auto switch toggles it and takes focus', () => {
    setup()
    const sw = screen.getByRole('switch', { name: 'Auto brightness' })
    fireEvent.pointerDown(sw)
    fireEvent.click(sw)
    expect(getSettings().autoBrightness).toBe(false)
    expect(focused()).toBe(sw)
  })
})
