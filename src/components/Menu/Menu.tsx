import { memo, useState } from 'react'
import { useKnownDevices } from '@/hooks/useKnownDevices'
import { Layer } from '@/input/router'
import { useKnobNav } from '@/input/useKnobNav'
import { accentVar, useTheme } from '@/theme/theme'
import { MenuGrid, MenuLink, MenuSheet, MenuTile } from './MenuSheet'

interface Props {
  open: boolean
  onClose: () => void

  showLyrics: boolean
  onToggleLyrics: () => void

  karaokeLyrics: boolean
  onToggleKaraoke: () => void

  voiceMic: boolean
  onToggleVoiceMic: () => void

  currentDevice?: string
  onOpenDevices: () => void

  onOpenBluetooth: () => void

  onOpenSettings: () => void
}

type Item = 'lyrics' | 'karaoke' | 'mic' | 'devices' | 'bluetooth' | 'settings'
const ITEMS: readonly Item[] = ['lyrics', 'karaoke', 'mic', 'devices', 'bluetooth', 'settings']

function MenuImpl({
  open,
  onClose,
  showLyrics,
  onToggleLyrics,
  karaokeLyrics,
  onToggleKaraoke,
  voiceMic,
  onToggleVoiceMic,
  currentDevice,
  onOpenDevices,
  onOpenBluetooth,
  onOpenSettings,
}: Props) {
  const theme = useTheme()
  const { devices: phones } = useKnownDevices(open)
  // the phone sharing its internet is the one in use, as the Bluetooth menu has it
  const phone = phones?.find((d) => d.network) ?? phones?.find((d) => d.connected)
  const actions: Record<Item, () => void> = {
    lyrics: onToggleLyrics,
    karaoke: onToggleKaraoke,
    mic: onToggleVoiceMic,
    devices: onOpenDevices,
    bluetooth: onOpenBluetooth,
    settings: onOpenSettings,
  }
  const nav = useKnobNav({
    keys: ITEMS,
    onSelect: (item) => actions[item](),
    enabled: open,
    layer: Layer.modal,
  })

  // every open starts at the top
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) nav.setFocus(ITEMS[0])
  }

  return (
    <MenuSheet open={open} onClose={onClose} title="Quick access" style={accentVar(theme)}>
      <MenuGrid columns={3}>
        <MenuTile
          icon="textLines"
          label="Show lyrics"
          on={showLyrics}
          {...nav.itemProps('lyrics')}
        />
        <MenuTile icon="lyrics" label="Karaoke" on={karaokeLyrics} {...nav.itemProps('karaoke')} />
        <MenuTile
          icon={voiceMic ? 'microphone' : 'microphoneOff'}
          label="Mic"
          on={voiceMic}
          {...nav.itemProps('mic')}
        />
      </MenuGrid>
      <MenuGrid columns={3}>
        <MenuLink
          icon="speakerBox"
          label="Devices"
          detail={currentDevice ?? 'Switch'}
          {...nav.itemProps('devices')}
        />
        <MenuLink
          icon="bluetooth"
          label="Bluetooth"
          detail={phone ? phone.name : 'Pair a phone'}
          {...nav.itemProps('bluetooth')}
        />
        <MenuLink
          icon="gear"
          label="Settings"
          detail="Display & more"
          {...nav.itemProps('settings')}
        />
      </MenuGrid>
    </MenuSheet>
  )
}

export const Menu = memo(MenuImpl)
