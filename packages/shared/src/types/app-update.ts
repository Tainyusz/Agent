/**
 * 应用自动更新相关类型定义
 */

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface AppUpdateInfo {
  version: string
  releaseName?: string | null
  releaseNotes?: string | Array<{ version: string; note: string | null }> | null
  releaseDate?: string
}

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface AppUpdateState {
  status: AppUpdateStatus
  currentVersion: string
  updateInfo?: AppUpdateInfo
  progress?: AppUpdateProgress
  error?: string
  manual?: boolean
  checkedAt?: string
}

export const APP_UPDATE_IPC_CHANNELS = {
  GET_STATE: 'app-update:get-state',
  CHECK: 'app-update:check',
  INSTALL: 'app-update:install',
  STATE_CHANGED: 'app-update:state-changed',
} as const
