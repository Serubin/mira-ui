import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { hw, REVERSAL_GAP_MS, withRouter } from '@/__tests__/hardware'
import { server } from '@/__tests__/msw-server'
import type { KnobStep } from '@/input/knob'
import { Layer } from '@/input/router'
import { useKnobScope } from '@/input/useKnobScope'

vi.mock('@/api/eventBus', () => ({ subscribeEvents: () => () => {} }))

import { Menu } from '../Menu'

const baseProps = () => ({
  open: true,
  onClose: vi.fn(),
  showLyrics: true,
  onToggleLyrics: vi.fn(),
  karaokeLyrics: true,
  onToggleKaraoke: vi.fn(),
  voiceMic: true,
  onToggleVoiceMic: vi.fn(),
  onOpenDevices: vi.fn(),
  onOpenBluetooth: vi.fn(),
  onOpenSettings: vi.fn(),
})

describe('Menu', () => {
  it('hides the dialog from assistive tech when open=false', () => {
    const { container } = render(<Menu {...baseProps()} open={false} />)
    const root = container.firstElementChild
    expect(root).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the Show Lyrics row when open, and no longer the reset row', () => {
    render(<Menu {...baseProps()} />)
    expect(screen.getByText('Show lyrics')).toBeInTheDocument()
    expect(screen.queryByText('Reset device')).toBeNull()
  })

  it('fires onToggleLyrics when the Show Lyrics row is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Show lyrics'))
    expect(props.onToggleLyrics).toHaveBeenCalledTimes(1)
  })

  it('fires onToggleKaraoke when the Karaoke Lyrics row is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Karaoke'))
    expect(props.onToggleKaraoke).toHaveBeenCalledTimes(1)
  })

  it('fires onToggleVoiceMic when the Mic row is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Mic'))
    expect(props.onToggleVoiceMic).toHaveBeenCalledTimes(1)
  })

  it('fires onOpenSettings when the Settings row is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Settings'))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('fires onOpenBluetooth when the Bluetooth row is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Bluetooth'))
    expect(props.onOpenBluetooth).toHaveBeenCalledTimes(1)
  })

  it('names the phone sharing its internet on the Bluetooth row', async () => {
    server.use(
      http.get('*/bluetooth/known', () =>
        HttpResponse.json([
          {
            address: 'AA',
            name: 'Desktop PC',
            starred: false,
            last_connected: '',
            connected: true,
            network: false,
          },
          {
            address: 'BB',
            name: 'Samsung',
            starred: true,
            last_connected: '',
            connected: true,
            network: true,
          },
        ]),
      ),
    )
    render(<Menu {...baseProps()} />)
    expect(await screen.findByText('Samsung')).toBeInTheDocument()
    expect(screen.queryByText('Pair a phone')).toBeNull()
  })

  it('offers pairing when no phone is connected', async () => {
    render(<Menu {...baseProps()} />)
    expect(await screen.findByText('Pair a phone')).toBeInTheDocument()
  })

  it('lays the links out in knob order', () => {
    render(<Menu {...baseProps()} />)
    const links = screen.getAllByRole('button')
    expect(links).toHaveLength(3)
    expect(links[0]).toHaveTextContent(/^Devices/)
    expect(links[1]).toHaveTextContent(/^Bluetooth/)
    expect(links[2]).toHaveTextContent(/^Settings/)
  })

  describe('with the knob', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
    const turn = (n: number, dir: KnobStep) => {
      hw.turnSteps(n, dir, { advance })
      advance(REVERSAL_GAP_MS)
    }
    const focused = () => document.querySelector('.focused')?.textContent

    // the player's volume sits under the menu
    function Volume({ onStep }: { onStep: () => void }) {
      useKnobScope({ layer: Layer.base, enabled: true, onStep, onSelect: () => true })
      return null
    }

    function setup(open = true) {
      const props = { ...baseProps(), open }
      const volume = vi.fn()
      const ui = (o: boolean) => (
        <>
          <Volume onStep={volume} />
          <Menu {...props} open={o} />
        </>
      )
      const r = render(ui(open), { wrapper: withRouter })
      return { props, volume, setOpen: (o: boolean) => r.rerender(ui(o)) }
    }

    it('walks the tiles then the links, and presses the focused one', () => {
      const { props, volume } = setup()
      expect(focused()).toMatch(/^Show lyrics/)
      turn(3, 1)
      expect(focused()).toMatch(/^Devices/)
      hw.press()
      expect(props.onOpenDevices).toHaveBeenCalledTimes(1)
      expect(volume).not.toHaveBeenCalled()
    })

    it('reaches bluetooth between devices and settings', () => {
      const { props } = setup()
      turn(4, 1)
      expect(focused()).toMatch(/^Bluetooth/)
      hw.press()
      expect(props.onOpenBluetooth).toHaveBeenCalledTimes(1)
      turn(1, 1)
      expect(focused()).toMatch(/^Settings/)
      hw.press()
      expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
    })

    it('starts at the top again on every open', () => {
      const { setOpen } = setup()
      turn(5, 1)
      expect(focused()).toMatch(/^Settings/)
      setOpen(false)
      setOpen(true)
      expect(focused()).toMatch(/^Show lyrics/)
    })

    it('leaves the knob to the player while closed', () => {
      const { props, volume } = setup(false)
      turn(1, 1)
      hw.press()
      expect(volume).toHaveBeenCalled()
      expect(props.onToggleLyrics).not.toHaveBeenCalled()
    })
  })
})
