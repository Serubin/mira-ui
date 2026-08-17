import { memo } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import { Marquee } from '@/components/TrackInfo/Marquee'
import type { DJNarration } from '@/hooks/useIsDJContext'
import type { ObserverStatusActive } from '@/api/types'
import styles from './NoLyricsView.module.scss'

interface Props {
  status: ObserverStatusActive
  active?: boolean
  // shrinks with the display size so the 130% glow stays inside the stage row
  artSize?: number
  // owned by App so the hold survives status moving on to the next song
  narration?: DJNarration
}

const ART_SIZE = 220

function NoLyricsViewImpl({ status, active = true, artSize = ART_SIZE, narration }: Props) {
  // while the DJ talks, status already points at the next song, so none of it may show
  const narrating = narration?.narrating ?? false
  const djTitle = narration?.title ?? ''
  const djArtist = narration?.artist ?? ''
  const art = narrating ? '' : status.track_image
  const glowStyle = art ? ({ '--art': `url("${art}")` } as React.CSSProperties) : undefined

  return (
    <div className={styles.wrap}>
      <div className={styles.art}>
        {art ? (
          <div
            className={`${styles.glow} ${active ? '' : styles.paused}`}
            style={glowStyle}
            aria-hidden
          >
            <span className={`${styles.orb} ${styles.orbA}`} />
            <span className={`${styles.orb} ${styles.orbB}`} />
          </div>
        ) : null}
        <div className={styles.cover}>
          <AlbumArt src={art} size={artSize} djFallback={narrating} />
        </div>
      </div>
      <div className={styles.meta}>
        <Marquee
          text={narrating ? djTitle : status.track_name || 'Unknown track'}
          className={styles.title}
        />
        <Marquee
          text={narrating ? djArtist : status.track_artist || 'Unknown artist'}
          className={styles.artist}
        />
      </div>
    </div>
  )
}

export const NoLyricsView = memo(NoLyricsViewImpl)
