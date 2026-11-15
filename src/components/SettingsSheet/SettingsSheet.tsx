import { memo, useState } from 'react'
import { MenuControl, MenuLink, MenuSheet, useRowInView } from '@/components/Menu'
import { Layer } from '@/input/router'
import { useBackCapture } from '@/input/useBackCapture'
import { useKnobNav } from '@/input/useKnobNav'
import { useKnobScope } from '@/input/useKnobScope'
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  updateSettings,
  useSettings,
  VOLUME_STEP_MAX,
  VOLUME_STEP_MIN,
} from '@/settings'
import { accentVar, useTheme } from '@/theme/theme'
import { NotchedSlider, SettingRow } from '@/ui/controls'
import { Icon } from '@/ui/icons'

interface Props {
  open: boolean
  onClose: () => void
  // active device is a phone
  phoneVolume?: boolean
  onOpenBluetooth?: () => void
}

const OFFSET_MIN = -500
const OFFSET_MAX = 500
const OFFSET_STEP = 50

type Slider = 'scale' | 'offset' | 'volume' | 'brightness'
type Item = Slider | 'autoBrightness' | 'bluetooth'

const ROWS: readonly Item[] = ['scale', 'offset', 'volume', 'autoBrightness', 'brightness']
const WITH_BLUETOOTH: readonly Item[] = [...ROWS, 'bluetooth']

function fmtOffset(ms: number): string {
  if (ms === 0) return '0 ms'
  return `${ms > 0 ? '+' : ''}${ms} ms`
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function SettingsSheetImpl({ open, onClose, phoneVolume = false, onOpenBluetooth }: Props) {
  const theme = useTheme()
  const { lyricOffsetMs, volumeStepPct, autoBrightness, brightness, uiScalePct } = useSettings()

  // applying the scale mid-drag moves this very panel under the finger, which has no
  // fixed point near a notch boundary and makes the whole ui flicker between two sizes.
  // so track the drag locally and only commit on release
  const [scalePreview, setScalePreview] = useState<number | null>(null)
  const shownScale = scalePreview ?? uiScalePct

  // the slider the knob is turning, until a press or Back hands the knob back to the rows
  const [adjusting, setAdjusting] = useState<Slider | null>(null)

  // shared by each NotchedSlider and the knob's adjust mode
  const sliders: Record<
    Slider,
    { value: number; min: number; max: number; step: number; onChange: (v: number) => void }
  > = {
    scale: {
      value: shownScale,
      min: UI_SCALE_MIN,
      max: UI_SCALE_MAX,
      step: UI_SCALE_STEP,
      onChange: setScalePreview,
    },
    offset: {
      value: lyricOffsetMs,
      min: OFFSET_MIN,
      max: OFFSET_MAX,
      step: OFFSET_STEP,
      onChange: (v) => updateSettings({ lyricOffsetMs: v }),
    },
    volume: {
      value: volumeStepPct,
      min: VOLUME_STEP_MIN,
      max: VOLUME_STEP_MAX,
      step: 1,
      onChange: (v) => updateSettings({ volumeStepPct: v }),
    },
    brightness: {
      value: brightness,
      min: BRIGHTNESS_MIN,
      max: BRIGHTNESS_MAX,
      step: 1,
      onChange: (v) => updateSettings({ brightness: v }),
    },
  }

  const stopAdjusting = () => {
    if (adjusting === 'scale' && scalePreview !== null) {
      updateSettings({ uiScalePct: scalePreview })
      setScalePreview(null)
    }
    setAdjusting(null)
  }

  const items = onOpenBluetooth ? WITH_BLUETOOTH : ROWS
  const disabled = (item: Item) =>
    (item === 'volume' && phoneVolume) || (item === 'brightness' && autoBrightness)
  const nav = useKnobNav({
    keys: items,
    onSelect: (item) => {
      if (item === 'autoBrightness') updateSettings({ autoBrightness: !autoBrightness })
      else if (item === 'bluetooth') onOpenBluetooth?.()
      else setAdjusting(item)
    },
    disabled,
    enabled: open && adjusting === null,
    layer: Layer.modal,
  })

  useKnobScope({
    layer: Layer.modal,
    enabled: open && adjusting !== null,
    onStep: (dir) => {
      if (!adjusting) return
      const s = sliders[adjusting]
      const next = clamp(s.value + dir * s.step, s.min, s.max)
      if (next !== s.value) s.onChange(next)
    },
    onSelect: stopAdjusting,
  })

  useBackCapture(open && adjusting !== null, stopAdjusting)

  // every open starts at the top. a dismissal drops an uncommitted size, as a cancelled drag does
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (scalePreview !== null) setScalePreview(null)
    if (adjusting !== null) setAdjusting(null)
    if (open) nav.setFocus(items[0])
  }

  // the slider would otherwise keep turning after it went disabled under the knob
  if (adjusting !== null && disabled(adjusting)) setAdjusting(null)

  // the auto switch sits in the brightness row
  const focusRow = nav.focusKey === 'autoBrightness' ? 'brightness' : nav.focusKey
  const body = useRowInView(focusRow, open, uiScalePct)

  // a touch moves focus there and abandons any knob adjustment elsewhere. committing a
  // previewed size now would rescale the panel under the finger
  const touch = (item: Item) => () => {
    if (adjusting !== null && adjusting !== item) {
      setScalePreview(null)
      setAdjusting(null)
    }
    nav.setFocus(item)
  }
  const control = (item: Slider) => ({
    focused: nav.focusKey === item,
    active: adjusting === item,
    onPointerDownCapture: touch(item),
  })

  return (
    <MenuSheet
      open={open}
      onClose={onClose}
      title="Settings"
      style={accentVar(theme)}
      bodyRef={body}
    >
      {/* first on purpose: at the largest display size the panel scrolls, and this is
        the one control that has to stay reachable to get back down */}
      <div data-row="scale">
        <MenuControl {...control('scale')}>
          <SettingRow
            icon={<Icon name="displaySize" size={20} />}
            label="Display size"
            value={`${shownScale}%`}
          >
            <NotchedSlider
              ariaLabel="Display size"
              {...sliders.scale}
              onCommit={(v) => {
                setScalePreview(null)
                // the sheet was dismissed mid-gesture, so drop the drag instead of
                // resizing the whole ui after it's gone
                if (!open) return
                updateSettings({ uiScalePct: v })
              }}
              onCancel={() => setScalePreview(null)}
              format={(v) => `${v}%`}
              defaultValue={UI_SCALE_DEFAULT}
            />
          </SettingRow>
        </MenuControl>
      </div>

      <div data-row="offset">
        <MenuControl {...control('offset')}>
          <SettingRow
            icon={<Icon name="lyrics" size={20} />}
            label="Lyric sync"
            value={fmtOffset(lyricOffsetMs)}
          >
            <NotchedSlider
              ariaLabel="Lyric sync offset"
              {...sliders.offset}
              format={fmtOffset}
              defaultValue={0}
            />
          </SettingRow>
        </MenuControl>
      </div>

      <div data-row="volume">
        <MenuControl {...control('volume')}>
          <SettingRow
            icon={<Icon name="speaker" size={20} />}
            label="Volume per turn"
            value={phoneVolume ? 'Set by phone' : `${volumeStepPct}%`}
          >
            <NotchedSlider
              ariaLabel="Volume per turn"
              {...sliders.volume}
              format={(v) => `${v}%`}
              disabled={phoneVolume}
              defaultValue={2}
            />
          </SettingRow>
        </MenuControl>
      </div>

      <div data-row="brightness">
        <MenuControl
          {...control('brightness')}
          onPointerDownCapture={(e) => {
            const onSwitch = (e.target as Element).closest('[role="switch"]')
            touch(onSwitch ? 'autoBrightness' : 'brightness')()
          }}
        >
          <SettingRow
            icon={<Icon name="sun" size={20} />}
            label="Brightness"
            value={autoBrightness ? 'Auto' : `${brightness * 10}%`}
            iconSwitch={{
              checked: autoBrightness,
              onChange: (on) => updateSettings({ autoBrightness: on }),
              label: 'Auto brightness',
              focused: nav.focusKey === 'autoBrightness',
            }}
          >
            <NotchedSlider
              ariaLabel="Brightness"
              {...sliders.brightness}
              format={(v) => `${v * 10}%`}
              disabled={autoBrightness}
              defaultValue={5}
            />
          </SettingRow>
        </MenuControl>
      </div>

      {onOpenBluetooth ? (
        <div data-row="bluetooth" onPointerDownCapture={touch('bluetooth')}>
          <MenuLink icon="bluetooth" label="Bluetooth pairing" {...nav.itemProps('bluetooth')} />
        </div>
      ) : null}
    </MenuSheet>
  )
}

export const SettingsSheet = memo(SettingsSheetImpl)
