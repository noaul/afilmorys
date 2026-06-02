import type { ReactNode } from 'react'
import { createContext, use, useEffect, useMemo } from 'react'
import type { StoreApi } from 'zustand'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { presentBillingUpgradeModal, resolveBillingUpgradeCategory } from '~/modules/billing/upgrade-prompts'

import type { PhotoSyncProgressEvent } from '../../../types'
import type { PhotoUploadRequestOptions } from '../upload.types'
import { clearActivePhotoUploadStoreIfMatches, setActivePhotoUploadStore } from './active-store'
import type { FileProgressEntry, PreviewCache, ProcessingLogEntry, ProcessingState, WorkflowPhase } from './types'
import {
  calculateTotalSize,
  calculateUploadedBytes,
  collectUnmatchedMovFiles,
  createFileEntries,
  createFileList,
  createStageStateFromTotals,
  deriveDirectoryFromTags,
  entryFingerprint,
  getErrorMessage,
  normalizeStageCount,
  primePreviewCache,
  rememberRecentTags,
  revokePreviewUrls,
} from './utils'

export type AddFilesResult = {
  added: number
  skipped: number
}

type PhotoUploadStoreState = {
  files: File[]
  totalSize: number
  uploadedBytes: number
  availableTags: string[]
  selectedTags: string[]
  unmatchedMovFiles: File[]
  hasMovFile: boolean
  phase: WorkflowPhase
  uploadEntries: FileProgressEntry[]
  uploadError: string | null
  processingError: string | null
  processingState: ProcessingState | null
  processingLogs: ProcessingLogEntry[]
  removeEntry: (entry: FileProgressEntry) => void
  addFiles: (files: File[]) => AddFilesResult
  beginUpload: () => Promise<void>
  abortCurrent: () => void
  reset: () => void
  closeModal: () => void
  setSelectedTags: (tags: string[]) => void
  ensurePreviews: () => void
  cleanup: () => void
}

type PhotoUploadStoreParams = {
  files: File[]
  availableTags: string[]
  onUpload: (files: FileList, options: PhotoUploadRequestOptions) => void | Promise<void>
  onClose: () => void
}

export type PhotoUploadStore = StoreApi<PhotoUploadStoreState>

const PhotoUploadStoreContext = createContext<PhotoUploadStore | null>(null)

const computeUploadedBytes = (entries: FileProgressEntry[]) => calculateUploadedBytes(entries)
const MAX_PROCESSING_LOGS = 200
let processingLogSequence = 0
// Extend upload request timeout to tolerate larger batches / slower networks (10 minutes).
const UPLOAD_REQUEST_TIMEOUT_MS = 600_000

// eslint-disable-next-line react-refresh/only-export-components
export function createPhotoUploadStore(params: PhotoUploadStoreParams): PhotoUploadStore {
  const { files: initialFiles, availableTags, onUpload, onClose } = params
  const previewCache: PreviewCache = new Map()
  const initialEntries = createFileEntries(initialFiles, previewCache)
  const totalSize = calculateTotalSize(initialFiles)
  const { unmatched: unmatchedMovFiles, hasMov } = collectUnmatchedMovFiles(initialFiles)

  let uploadAbortController: AbortController | null = null

  const store = createStore<PhotoUploadStoreState>((set, get) => {
    const updateEntries = (updater: (entries: FileProgressEntry[]) => FileProgressEntry[]) => {
      set((state) => {
        const nextEntries = updater(state.uploadEntries)
        return {
          uploadEntries: nextEntries,
          uploadedBytes: computeUploadedBytes(nextEntries),
        }
      })
    }

    const handleProcessingEvent = (event: PhotoSyncProgressEvent) => {
      if (event.type === 'start') {
        updateEntries(entries =>
          entries.map(entry => ({
            ...entry,
            status: entry.status === 'uploading' ? 'processing' : entry.status,
          })))
        const { summary, totals, options: eventOptions } = event.payload
        set({
          phase: 'processing',
          processingError: null,
          processingState: {
            dryRun: eventOptions?.dryRun ?? false,
            summary,
            totals,
            stages: createStageStateFromTotals(totals),
            completed: false,
          },
          processingLogs: [],
        })
        return
      }

      set((state) => {
        if (event.type === 'log') {
          const timestamp = Date.parse(event.payload.timestamp)
          const logEntry: ProcessingLogEntry = {
            id: `log-${processingLogSequence++}`,
            message: event.payload.message,
            level: event.payload.level,
            timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
          }
          return {
            processingState: state.processingState
              ? {
                  ...state.processingState,
                  latestLog: {
                    message: logEntry.message,
                    level: logEntry.level,
                    timestamp: logEntry.timestamp,
                  },
                }
              : state.processingState,
            processingLogs: [...state.processingLogs, logEntry].slice(-MAX_PROCESSING_LOGS),
          }
        }

        const prev = state.processingState
        if (!prev) {
          if (event.type === 'error') {
            return {
              phase: 'error',
              processingError: event.payload.message,
            }
          }
          return {}
        }

        switch (event.type) {
          case 'stage': {
            const { stage, status, processed, total, summary } = event.payload
            const prevStage = prev.stages[stage]
            const normalizedTotal = normalizeStageCount(total, prevStage?.total ?? 0)
            const normalizedProcessed = normalizeStageCount(processed, prevStage?.processed ?? 0)
            return {
              processingState: {
                ...prev,
                summary,
                stages: {
                  ...prev.stages,
                  [stage]: {
                    status: status === 'complete' || normalizedTotal === 0 ? 'completed' : 'running',
                    processed: Math.min(normalizedProcessed, normalizedTotal),
                    total: normalizedTotal,
                  },
                },
              },
            }
          }
          case 'action': {
            const { stage, index, total, summary } = event.payload
            const prevStage = prev.stages[stage]
            const normalizedTotal = normalizeStageCount(total, prevStage?.total ?? 0)
            const normalizedProcessed = normalizeStageCount(index, prevStage?.processed ?? 0)
            return {
              processingState: {
                ...prev,
                summary,
                stages: {
                  ...prev.stages,
                  [stage]: {
                    status: normalizedTotal === 0 ? 'completed' : 'running',
                    processed: Math.min(normalizedProcessed, normalizedTotal),
                    total: normalizedTotal,
                  },
                },
              },
            }
          }
          case 'error': {
            updateEntries(entries =>
              entries.map(entry => ({
                ...entry,
                status: entry.status === 'processing' ? 'error' : entry.status,
              })))
            return {
              phase: 'error',
              processingError: event.payload.message,
              processingState: {
                ...prev,
                error: event.payload.message,
              },
            }
          }
          case 'complete': {
            updateEntries(entries =>
              entries.map(entry => ({
                ...entry,
                status: entry.status === 'processing' ? 'done' : entry.status,
                progress: 1,
                uploadedBytes: entry.size,
              })))
            return {
              phase: 'completed',
              processingState: {
                ...prev,
                summary: event.payload.summary,
                completed: true,
              },
            }
          }
          default: {
            return {}
          }
        }
      })
    }

    const handleUploadProgress: NonNullable<PhotoUploadRequestOptions['onUploadProgress']> = (snapshot) => {
      const progressMap = new Map(snapshot.files.map(file => [file.index, file]))
      updateEntries(entries =>
        entries.map((entry) => {
          const current = progressMap.get(entry.index)
          if (!current) {
            return entry
          }
          return {
            ...entry,
            status: entry.status === 'pending' ? 'uploading' : entry.status,
            progress: current.progress,
            uploadedBytes: current.uploadedBytes,
          }
        }))
    }

    return {
      files: initialFiles,
      totalSize,
      uploadedBytes: 0,
      availableTags,
      selectedTags: [],
      unmatchedMovFiles,
      hasMovFile: hasMov,
      phase: 'review',
      uploadEntries: initialEntries,
      uploadError: null,
      processingError: null,
      processingState: null,
      processingLogs: [],
      removeEntry: (entry) => {
        const state = get()
        if (state.phase !== 'review') {
          return
        }

        const removedFile = state.files[entry.index]
        const nextFiles = state.files.filter((_, index) => index !== entry.index)
        if (nextFiles.length === state.files.length) {
          return
        }

        if (removedFile) {
          const fp = entryFingerprint(removedFile)
          const stillUsed = nextFiles.some(file => entryFingerprint(file) === fp)
          if (!stillUsed) {
            revokePreviewUrls(previewCache, [fp])
          }
        }

        const nextEntries = createFileEntries(nextFiles, previewCache)
        const nextTotalSize = calculateTotalSize(nextFiles)
        const { unmatched, hasMov } = collectUnmatchedMovFiles(nextFiles)

        set({
          files: nextFiles,
          totalSize: nextTotalSize,
          unmatchedMovFiles: unmatched,
          hasMovFile: hasMov,
          uploadEntries: nextEntries,
          uploadedBytes: computeUploadedBytes(nextEntries),
        })

        get().ensurePreviews()
      },
      addFiles: (incoming) => {
        const state = get()
        if (state.phase !== 'review' || incoming.length === 0) {
          return { added: 0, skipped: 0 }
        }

        const existing = new Set(state.files.map(entryFingerprint))

        const toAdd: File[] = []
        let skipped = 0
        for (const file of incoming) {
          const fp = entryFingerprint(file)
          if (existing.has(fp)) {
            skipped++
            continue
          }
          existing.add(fp)
          toAdd.push(file)
        }

        if (toAdd.length === 0) {
          return { added: 0, skipped }
        }

        const nextFiles = [...state.files, ...toAdd]
        const nextEntries = createFileEntries(nextFiles, previewCache)
        const nextTotalSize = calculateTotalSize(nextFiles)
        const { unmatched, hasMov } = collectUnmatchedMovFiles(nextFiles)

        set({
          files: nextFiles,
          totalSize: nextTotalSize,
          unmatchedMovFiles: unmatched,
          hasMovFile: hasMov,
          uploadEntries: nextEntries,
          uploadedBytes: computeUploadedBytes(nextEntries),
        })

        get().ensurePreviews()

        return { added: toAdd.length, skipped }
      },
      beginUpload: async () => {
        const state = get()
        if (state.unmatchedMovFiles.length > 0 || state.phase === 'uploading' || state.phase === 'processing') {
          return
        }
        if (state.files.length === 0) {
          return
        }

        set({
          uploadError: null,
          processingError: null,
          processingState: null,
          phase: 'uploading',
          processingLogs: [],
        })

        updateEntries(entries =>
          entries.map(entry => ({
            ...entry,
            status: 'uploading',
          })))

        const controller = new AbortController()
        uploadAbortController = controller

        try {
          const tags = get().selectedTags
          rememberRecentTags(tags)
          const directory = deriveDirectoryFromTags(tags)
          const fileList = createFileList(get().files)
          await onUpload(fileList, {
            signal: controller.signal,
            directory: directory ?? undefined,
            onUploadProgress: handleUploadProgress,
            timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
            onServerEvent: handleProcessingEvent,
          })
        }
        catch (error) {
          const isAbort = (error as DOMException)?.name === 'AbortError'
          if (isAbort) {
            set({ phase: 'review' })
            const currentFiles = get().files
            updateEntries(() => createFileEntries(currentFiles, previewCache))
          }
          else {
            const upgradeCategory = resolveBillingUpgradeCategory(error)
            if (upgradeCategory) {
              presentBillingUpgradeModal(upgradeCategory)
            }
            const message = getErrorMessage(error, '上传失败，请稍后再试。')
            set({
              uploadError: message,
              phase: 'error',
            })
            updateEntries(entries =>
              entries.map(entry => ({
                ...entry,
                status: entry.status === 'uploading' ? 'error' : entry.status,
              })))
          }
        }
        finally {
          uploadAbortController = null
        }
      },
      abortCurrent: () => {
        const { phase } = get()
        if (phase === 'uploading') {
          uploadAbortController?.abort()
          uploadAbortController = null
          set({ phase: 'review' })
          const currentFiles = get().files
          updateEntries(() => createFileEntries(currentFiles, previewCache))
          return
        }
        if (phase === 'processing') {
          uploadAbortController?.abort()
          uploadAbortController = null
          set({
            processingError: '服务器处理已终止',
            phase: 'error',
          })
          updateEntries(entries =>
            entries.map(entry => ({
              ...entry,
              status: entry.status === 'processing' ? 'error' : entry.status,
            })))
        }
      },
      reset: () => {
        uploadAbortController?.abort()
        uploadAbortController = null
        set({
          phase: 'review',
          uploadError: null,
          processingError: null,
          processingState: null,
          processingLogs: [],
        })
        const currentFiles = get().files
        updateEntries(() => createFileEntries(currentFiles, previewCache))
      },
      closeModal: () => {
        get().cleanup()
        onClose()
      },
      setSelectedTags: (tags: string[]) => {
        set({ selectedTags: tags })
      },
      ensurePreviews: () => {
        const { files, uploadEntries } = get()
        primePreviewCache(files, previewCache)
        let mutated = false
        const nextEntries = uploadEntries.map((entry) => {
          const cached = previewCache.get(entry.id) ?? null
          if (cached === entry.previewUrl) {
            return entry
          }
          mutated = true
          return { ...entry, previewUrl: cached }
        })
        if (mutated) {
          set({ uploadEntries: nextEntries })
        }
      },
      cleanup: () => {
        uploadAbortController?.abort()
        uploadAbortController = null
        revokePreviewUrls(previewCache)
      },
    }
  })

  return store
}

type PhotoUploadStoreProviderProps = PhotoUploadStoreParams & {
  children: ReactNode
}

export function PhotoUploadStoreProvider({
  children,
  files,
  availableTags,
  onUpload,
  onClose,
}: PhotoUploadStoreProviderProps) {
  const store = useMemo(
    () => createPhotoUploadStore({ files, availableTags, onUpload, onClose }),
    [files, availableTags, onUpload, onClose],
  )

  useEffect(() => {
    setActivePhotoUploadStore(store)
    store.getState().ensurePreviews()
    return () => {
      clearActivePhotoUploadStoreIfMatches(store)
      store.getState().cleanup()
    }
  }, [store])

  return <PhotoUploadStoreContext value={store}>{children}</PhotoUploadStoreContext>
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePhotoUploadStore<U>(selector: (state: PhotoUploadStoreState) => U) {
  const store = use(PhotoUploadStoreContext)
  if (!store) {
    throw new Error('usePhotoUploadStore must be used within PhotoUploadStoreProvider')
  }
  return useStore(store, selector)
}
