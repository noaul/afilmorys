import type { PickedExif } from '@afilmory/builder'
import { MobileTabGroup, MobileTabItem } from '@afilmory/ui'
import { useQuery } from '@tanstack/react-query'
import { m, type MotionValue, useTransform } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { injectConfig } from '~/config'
import { useViewport } from '~/hooks/useViewport'
import { commentsApi } from '~/lib/api/comments'
import { ExifPanelContent } from '~/modules/metadata/ExifPanel'
import { CommentsPanel } from '~/modules/social/comments'
import type { PhotoManifest } from '~/types/photo'

type Tab = 'info' | 'comments'

interface MobilePhotoInspectorSheetProps {
  currentPhoto: PhotoManifest
  exifData: PickedExif | null
  progress: MotionValue<number>
  onClose: () => void
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3)

export const MobilePhotoInspectorSheet = ({
  currentPhoto,
  exifData,
  progress,
  onClose,
}: MobilePhotoInspectorSheetProps) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<Tab>('info')
  const [isInteractive, setIsInteractive] = useState(false)
  const viewportHeight = useViewport((value) => value.h) || (typeof window !== 'undefined' ? window.innerHeight : 844)
  const sheetHeight = useMemo(() => clamp(viewportHeight * 0.68, 360, viewportHeight - 72), [viewportHeight])

  const showSocialFeatures = injectConfig.useCloud
  const { data: commentCount } = useQuery({
    queryKey: ['comment-count', currentPhoto.id],
    queryFn: () => commentsApi.count(currentPhoto.id),
    enabled: showSocialFeatures,
  })
  const hasComments = (commentCount?.count ?? 0) > 0

  useEffect(() => {
    setActiveTab('info')
  }, [currentPhoto.id])

  useEffect(() => {
    const unsubscribe = progress.on('change', (latest) => {
      setIsInteractive(clamp(latest, 0, 1) > 0.02)
    })

    return () => {
      unsubscribe()
    }
  }, [progress])

  const clampedProgress = useTransform(() => clamp(progress.get(), 0, 1))
  const sheetProgress = useTransform(() => easeOutCubic(clampedProgress.get()))
  const sheetY = useTransform(() => (1 - sheetProgress.get()) * (sheetHeight + 28))
  const sheetOpacity = useTransform(() => clamp(clampedProgress.get() * 1.6, 0, 1))
  const sheetScale = useTransform(() => 0.965 + sheetProgress.get() * 0.035)

  return (
    <m.div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center"
      aria-hidden={!isInteractive}
      style={{
        y: sheetY,
        opacity: sheetOpacity,
      }}
    >
      <m.div
        className="bg-material-ultra-thick border-accent/20 pointer-events-auto relative flex w-full max-w-screen-lg flex-col overflow-hidden rounded-t-[28px] border text-white backdrop-blur-3xl"
        style={{
          height: sheetHeight,
          scale: sheetScale,
          transformOrigin: '50% 100%',
          boxShadow:
            '0 -20px 64px color-mix(in srgb, var(--color-accent) 16%, transparent), 0 -8px 28px rgba(0, 0, 0, 0.32)',
          pointerEvents: isInteractive ? 'auto' : 'none',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 rounded-t-[28px]"
          style={{
            background:
              'linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 16%, color-mix(in srgb, var(--color-accent) 7%, transparent))',
          }}
        />

        <div className="relative z-10 flex shrink-0 flex-col px-4 pt-3">
          <div className="mb-3 flex items-center justify-center">
            <div className="h-1.5 w-11 rounded-full bg-white/20" />
          </div>

          <div className="relative">
            {showSocialFeatures ? (
              <MobileTabGroup
                value={activeTab}
                onValueChanged={(value) => setActiveTab(value as Tab)}
                className="mr-12"
              >
                <MobileTabItem
                  value="info"
                  label={
                    <div className="flex items-center">
                      <i className="i-mingcute-information-line mr-1.5 text-base" />
                      {t('inspector.tab.info')}
                    </div>
                  }
                />
                <MobileTabItem
                  value="comments"
                  label={
                    <div className="flex items-center">
                      <i className="i-mingcute-comment-line mr-1.5 text-base" />
                      {t('inspector.tab.comments')}
                      {hasComments && <div className="bg-accent ml-1.5 size-1.5 rounded-full" />}
                    </div>
                  }
                />
              </MobileTabGroup>
            ) : (
              <div className="px-2 pb-1 text-sm font-medium text-white/70">{t('exif.header.title')}</div>
            )}

            <button
              type="button"
              className="hover:bg-accent/10 absolute top-1 right-0 flex size-9 items-center justify-center rounded-xl text-white/80 transition-colors hover:text-white"
              onClick={onClose}
              aria-label="Close details"
            >
              <i className="i-mingcute-close-line text-lg" />
            </button>
          </div>
        </div>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          {activeTab === 'info' ? (
            <ExifPanelContent
              currentPhoto={currentPhoto}
              exifData={exifData}
              rootClassName="min-h-0 flex-1"
              viewportClassName="px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] **:select-text"
            />
          ) : (
            <div className="min-h-0 flex-1 pb-[calc(env(safe-area-inset-bottom)+8px)]">
              <CommentsPanel photoId={currentPhoto.id} />
            </div>
          )}
        </div>
      </m.div>
    </m.div>
  )
}
