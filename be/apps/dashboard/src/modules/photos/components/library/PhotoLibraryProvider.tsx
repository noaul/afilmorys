import { Prompt } from '@afilmory/ui'
import type { ReactNode } from 'react'
import { createContext, use, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { StoreApi } from 'zustand'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { getRequestErrorMessage } from '~/lib/errors'

import { useDeletePhotoAssetsMutation, usePhotoAssetListQuery, useUploadPhotoAssetsMutation } from '../../hooks'
import type { PhotoAssetListItem } from '../../types'
import { DeleteFromStorageOption } from './DeleteFromStorageOption'
import type { DeleteAssetOptions } from './types'
import type { PhotoUploadRequestOptions } from './upload.types'

type PhotoLibraryStoreState = {
  assets: PhotoAssetListItem[] | undefined
  isLoading: boolean
  isDeleting: boolean
  isUploading: boolean
  availableTags: string[]
  libraryTotalCount: number
  selectedIds: string[]
  toggleSelect: (id: string) => void
  clearSelection: () => void
  selectAll: () => void
  deleteAsset: (asset: PhotoAssetListItem, options?: DeleteAssetOptions) => Promise<void>
  deleteSelected: () => Promise<void>
  uploadAssets: (files: FileList, options?: PhotoUploadRequestOptions) => Promise<void>
  openAsset: (asset: PhotoAssetListItem) => Promise<void>
  refetchAssets: () => void
}

export type PhotoLibraryStore = StoreApi<PhotoLibraryStoreState>

type PhotoLibraryProviderProps = {
  isActive: boolean
  children: ReactNode
}

type CreatePhotoLibraryStoreParams = {
  requestDeleteAssets: (ids: string[], options?: DeleteAssetOptions) => Promise<void>
  requestUploadAssets: (files: File[], options?: PhotoUploadRequestOptions) => Promise<void>
  refetchAssets: () => void
}

const PhotoLibraryStoreContext = createContext<PhotoLibraryStore | null>(null)

function createPhotoLibraryStore(params: CreatePhotoLibraryStoreParams) {
  const { requestDeleteAssets, requestUploadAssets, refetchAssets } = params

  return createStore<PhotoLibraryStoreState>((set, get) => {
    const getAssetLabel = (asset: PhotoAssetListItem) =>
      asset.manifest?.data?.title ?? asset.manifest?.data?.id ?? asset.photoId

    const presentDeletePrompt = (
      label: string,
      onConfirm: (options: DeleteAssetOptions) => Promise<void> | void,
    ): Promise<void> => {
      let deleteFromStorage = false

      return new Promise((resolve) => {
        Prompt.prompt({
          title: '确认删除该资源？',
          description: `删除后将无法恢复，是否继续删除「${label}」？如需同时删除远程存储文件，可勾选下方选项。`,
          variant: 'danger',
          onConfirmText: '删除',
          onCancelText: '取消',
          content: (
            <DeleteFromStorageOption
              onChange={(checked) => {
                deleteFromStorage = checked
              }}
            />
          ),
          onConfirm: () => Promise.resolve(onConfirm({ deleteFromStorage })).finally(resolve),
          onCancel: resolve,
        })
      })
    }

    const performDelete = async (ids: string[], options?: DeleteAssetOptions) => {
      if (ids.length === 0) {
        return
      }
      set({ isDeleting: true })
      try {
        await requestDeleteAssets(ids, options)
        toast.success(`已删除 ${ids.length} 个资源`)
        set(state => ({
          selectedIds: state.selectedIds.filter(id => !ids.includes(id)),
        }))
        refetchAssets()
      }
      catch (error) {
        const message = getRequestErrorMessage(error, '删除失败，请稍后重试。')
        toast.error('删除失败', { description: message })
      }
      finally {
        set({ isDeleting: false })
      }
    }

    const performUpload = async (files: File[], options?: PhotoUploadRequestOptions) => {
      if (files.length === 0) {
        return
      }
      set({ isUploading: true })
      try {
        await requestUploadAssets(files, options)
        toast.success(`成功上传 ${files.length} 张图片`)
        refetchAssets()
      }
      catch (error) {
        const message = getRequestErrorMessage(error, '上传失败，请稍后重试。')
        toast.error('上传失败', { description: message })
        throw error
      }
      finally {
        set({ isUploading: false })
      }
    }

    const performOpenAsset = async (asset: PhotoAssetListItem) => {
      const photoId = asset.manifest?.data?.id ?? asset.photoId
      if (!photoId) {
        toast.error('打开失败', { description: '无法解析图片 ID' })
        return
      }

      const url = `${window.location.origin}/photos/${encodeURIComponent(photoId)}`
      window.open(url, '_blank', 'noopener,noreferrer')
    }

    return {
      assets: undefined,
      isLoading: false,
      isDeleting: false,
      isUploading: false,
      availableTags: [],
      libraryTotalCount: 0,
      selectedIds: [],
      toggleSelect: (id: string) =>
        set((state) => {
          const next = state.selectedIds.includes(id)
            ? state.selectedIds.filter(item => item !== id)
            : [...state.selectedIds, id]
          return { selectedIds: next }
        }),
      clearSelection: () => set({ selectedIds: [] }),
      selectAll: () =>
        set((state) => {
          if (!state.assets || state.assets.length === 0) {
            return {}
          }
          return { selectedIds: state.assets.map(asset => asset.id) }
        }),
      deleteAsset: (asset, options) => {
        if (options) {
          return performDelete([asset.id], options)
        }

        const assetLabel = getAssetLabel(asset)
        return presentDeletePrompt(assetLabel, promptOptions => performDelete([asset.id], promptOptions))
      },
      deleteSelected: () => {
        const ids = get().selectedIds
        if (ids.length === 0) {
          return Promise.resolve()
        }

        const assets = get().assets ?? []
        const selectedAssets = assets.filter(asset => ids.includes(asset.id))
        const targetLabel
          = selectedAssets.length === 1 ? getAssetLabel(selectedAssets[0]) : `选中的 ${ids.length} 个资源`

        return presentDeletePrompt(targetLabel, promptOptions => performDelete(ids, promptOptions))
      },
      uploadAssets: (files, options) => performUpload(Array.from(files), options),
      openAsset: performOpenAsset,
      refetchAssets,
    }
  })
}

function deriveAvailableTags(assets: PhotoAssetListItem[] | undefined) {
  if (!assets || assets.length === 0) {
    return []
  }

  const tagSet = new Set<string>()
  for (const asset of assets) {
    const tags = asset.manifest?.data?.tags
    if (!Array.isArray(tags)) {
      continue
    }
    for (const tag of tags) {
      const normalized = typeof tag === 'string' ? tag.trim() : ''
      if (normalized) {
        tagSet.add(normalized)
      }
    }
  }

  return Array.from(tagSet).sort((a, b) => a.localeCompare(b))
}

export function PhotoLibraryProvider({ isActive, children }: PhotoLibraryProviderProps) {
  const listQuery = usePhotoAssetListQuery({ enabled: isActive })
  const deleteMutation = useDeletePhotoAssetsMutation()
  const uploadMutation = useUploadPhotoAssetsMutation()

  const refetchListRef = useRef(listQuery.refetch)
  useEffect(() => {
    refetchListRef.current = listQuery.refetch
  }, [listQuery.refetch])

  const deleteMutationRef = useRef(deleteMutation)
  useEffect(() => {
    deleteMutationRef.current = deleteMutation
  }, [deleteMutation])

  const uploadMutationRef = useRef(uploadMutation)
  useEffect(() => {
    uploadMutationRef.current = uploadMutation
  }, [uploadMutation])

  const storeRef = useRef<PhotoLibraryStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createPhotoLibraryStore({
      requestDeleteAssets: (ids, options) =>
        deleteMutationRef.current.mutateAsync({
          ids,
          deleteFromStorage: options?.deleteFromStorage ?? false,
        }),
      requestUploadAssets: async (files, options) => {
        await uploadMutationRef.current.mutateAsync({
          files,
          onProgress: options?.onUploadProgress,
          signal: options?.signal,
          directory: options?.directory ?? undefined,
          timeoutMs: options?.timeoutMs,
          onServerEvent: options?.onServerEvent,
        })
      },
      refetchAssets: () => {
        const refetch = refetchListRef.current
        if (typeof refetch === 'function') {
          void refetch()
        }
      },
    })
  }

  const store = storeRef.current

  useEffect(() => {
    store.setState({
      assets: listQuery.data,
      libraryTotalCount: listQuery.data?.length ?? 0,
      availableTags: deriveAvailableTags(listQuery.data),
      isLoading: listQuery.isLoading,
    })
  }, [store, listQuery.data, listQuery.isLoading])

  useEffect(() => {
    store.setState({ isDeleting: deleteMutation.isPending })
  }, [store, deleteMutation.isPending])

  useEffect(() => {
    store.setState({ isUploading: uploadMutation.isPending })
  }, [store, uploadMutation.isPending])

  useEffect(() => {
    if (!isActive) {
      store.setState({ selectedIds: [] })
    }
  }, [store, isActive])

  return <PhotoLibraryStoreContext value={store}>{children}</PhotoLibraryStoreContext>
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePhotoLibraryStore<T>(selector: (state: PhotoLibraryStoreState) => T): T {
  const store = use(PhotoLibraryStoreContext)
  if (!store) {
    throw new Error('PhotoLibraryProvider is missing in the component tree')
  }

  return useStore(store, selector)
}
