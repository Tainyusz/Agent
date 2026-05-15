/**
 * 应用自动更新服务
 *
 * 基于 electron-updater 读取打包产物中的 app-update.yml。
 * 发布源由 electron-builder.yml 的 publish 配置生成。
 */

import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import { APP_UPDATE_IPC_CHANNELS } from '@proma/shared'
import type { AppUpdateInfo, AppUpdateProgress, AppUpdateState } from '@proma/shared'
import { setQuitting } from './app-lifecycle'

let windowProvider: (() => BrowserWindow | null) | null = null
let initialized = false
let downloaded = false
let activeManualCheck = false

let state: AppUpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
}

function updateInfoToState(info: UpdateInfo | UpdateDownloadedEvent): AppUpdateInfo {
  return {
    version: info.version,
    releaseName: info.releaseName,
    releaseNotes: info.releaseNotes,
    releaseDate: info.releaseDate,
  }
}

function progressToState(info: ProgressInfo): AppUpdateProgress {
  return {
    percent: info.percent,
    transferred: info.transferred,
    total: info.total,
    bytesPerSecond: info.bytesPerSecond,
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function setState(next: Partial<AppUpdateState>): AppUpdateState {
  state = {
    ...state,
    ...next,
    currentVersion: app.getVersion(),
  }
  const win = windowProvider?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send(APP_UPDATE_IPC_CHANNELS.STATE_CHANGED, state)
  }
  return state
}

export function getAppUpdateState(): AppUpdateState {
  return state
}

export function initializeAppUpdater(getWindow: () => BrowserWindow | null): void {
  windowProvider = getWindow
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = console

  autoUpdater.on('checking-for-update', () => {
    setState({
      status: 'checking',
      error: undefined,
      progress: undefined,
      manual: activeManualCheck,
      checkedAt: new Date().toISOString(),
    })
  })

  autoUpdater.on('update-available', (info) => {
    setState({
      status: 'available',
      updateInfo: updateInfoToState(info),
      error: undefined,
      manual: activeManualCheck,
    })
  })

  autoUpdater.on('download-progress', (info) => {
    setState({
      status: 'downloading',
      progress: progressToState(info),
      error: undefined,
      manual: activeManualCheck,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    downloaded = true
    setState({
      status: 'downloaded',
      updateInfo: updateInfoToState(info),
      progress: undefined,
      error: undefined,
      manual: activeManualCheck,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    setState({
      status: 'not-available',
      updateInfo: updateInfoToState(info),
      progress: undefined,
      error: undefined,
      manual: activeManualCheck,
      checkedAt: new Date().toISOString(),
    })
  })

  autoUpdater.on('error', (error) => {
    setState({
      status: 'error',
      error: errorMessage(error),
      progress: undefined,
      manual: activeManualCheck,
      checkedAt: new Date().toISOString(),
    })
  })
}

export async function checkForAppUpdate(manual = false): Promise<AppUpdateState> {
  activeManualCheck = manual

  if (!app.isPackaged) {
    return setState({
      status: 'error',
      error: '开发模式不支持自动更新，请打包后测试。',
      manual,
      checkedAt: new Date().toISOString(),
    })
  }

  try {
    await autoUpdater.checkForUpdates()
    return state
  } catch (error) {
    return setState({
      status: 'error',
      error: errorMessage(error),
      progress: undefined,
      manual,
      checkedAt: new Date().toISOString(),
    })
  }
}

export function scheduleAutoUpdateCheck(delayMs = 15_000): void {
  if (!app.isPackaged) return
  setTimeout(() => {
    checkForAppUpdate(false).catch((error) => {
      console.error('[自动更新] 启动检查失败:', error)
    })
  }, delayMs)
}

export function installDownloadedUpdate(): void {
  if (!downloaded && state.status !== 'downloaded') {
    throw new Error('更新包尚未下载完成')
  }
  setQuitting()
  autoUpdater.quitAndInstall(false, true)
}
