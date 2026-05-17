/**
 * 应用自动更新服务
 *
 * 基于 electron-updater 检查更新。
 * 客户端使用自有域名上的 generic 更新源，避免 GitHub releases.atom 在国内网络下不稳定。
 */

import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import { APP_UPDATE_IPC_CHANNELS } from '@proma/shared'
import type { AppUpdateInfo, AppUpdateProgress, AppUpdateState } from '@proma/shared'
import { setQuitting } from './app-lifecycle'

const APP_UPDATE_FEED_BASE_URL = 'https://nanopro.wxqsai.com/updates/agent'
const APP_UPDATE_FRIENDLY_ERROR = '哎呀，有点小问题 晚点再试试吧～'

let windowProvider: (() => BrowserWindow | null) | null = null
let initialized = false
let downloaded = false
let downloadedUpdateFile: string | null = null
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

function logUpdateError(context: string, error: unknown): void {
  console.warn(`[自动更新] ${context}:`, error)
}

function friendlyUpdateErrorMessage(): string {
  return APP_UPDATE_FRIENDLY_ERROR
}

function getAppUpdateFeedUrl(): string {
  if (process.platform === 'win32') return `${APP_UPDATE_FEED_BASE_URL}/win`
  return `${APP_UPDATE_FEED_BASE_URL}/mac`
}

function getCurrentMacAppBundlePath(): string | null {
  let current = process.execPath
  while (current && current !== dirname(current)) {
    if (current.endsWith('.app')) return current
    current = dirname(current)
  }
  return null
}

function createInternalMacInstallScript(): { scriptPath: string; logPath: string } {
  const scriptPath = join(app.getPath('temp'), `wuxianqingsong-update-${Date.now()}.sh`)
  const logPath = join(app.getPath('userData'), 'mac-internal-update.log')
  const script = `#!/bin/bash
set -u

ZIP_FILE="$1"
TARGET_APP="$2"
APP_PID="$3"
LOG_FILE="$4"
APP_IDENTIFIER="com.wuxianqingsong.app"

exec >>"$LOG_FILE" 2>&1
echo "==== $(date '+%Y-%m-%d %H:%M:%S') internal mac update ===="
echo "zip: $ZIP_FILE"
echo "target: $TARGET_APP"
echo "pid: $APP_PID"

if [ ! -f "$ZIP_FILE" ]; then
  echo "update zip not found"
  exit 2
fi

if [ ! -d "$TARGET_APP" ]; then
  echo "target app not found"
  exit 3
fi

TMP_DIR="$(/usr/bin/mktemp -d "\${TMPDIR:-/tmp}/wuxianqingsong-update.XXXXXX")"
cleanup() {
  /bin/rm -rf "$TMP_DIR"
}
trap cleanup EXIT

/usr/bin/ditto -x -k "$ZIP_FILE" "$TMP_DIR"
NEW_APP="$(/usr/bin/find "$TMP_DIR" -maxdepth 2 -type d -name "*.app" -print -quit)"

if [ -z "$NEW_APP" ] || [ ! -d "$NEW_APP" ]; then
  echo "new app not found in update zip"
  exit 4
fi

NEW_IDENTIFIER="$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$NEW_APP/Contents/Info.plist" 2>/dev/null || true)"
if [ "$NEW_IDENTIFIER" != "$APP_IDENTIFIER" ]; then
  echo "unexpected bundle identifier: $NEW_IDENTIFIER"
  exit 5
fi

/usr/bin/xattr -cr "$NEW_APP" || true

COUNT=0
while /bin/kill -0 "$APP_PID" 2>/dev/null; do
  /bin/sleep 0.25
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -gt 480 ]; then
    echo "timed out waiting for app to quit"
    exit 6
  fi
done

/bin/sleep 0.5
BACKUP_APP="\${TARGET_APP}.previous-update"
/bin/rm -rf "$BACKUP_APP"

if [ -d "$TARGET_APP" ]; then
  /bin/mv "$TARGET_APP" "$BACKUP_APP"
fi

/bin/mv "$NEW_APP" "$TARGET_APP"
/usr/bin/xattr -cr "$TARGET_APP" || true
/usr/bin/open "$TARGET_APP"

/bin/sleep 3
/bin/rm -rf "$BACKUP_APP"
echo "update installed"
`
  writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o700 })
  chmodSync(scriptPath, 0o700)
  return { scriptPath, logPath }
}

function installDownloadedMacUpdateInternally(): boolean {
  if (process.platform !== 'darwin') return false
  if (!downloadedUpdateFile || !existsSync(downloadedUpdateFile)) return false

  const appBundlePath = getCurrentMacAppBundlePath()
  if (!appBundlePath) return false

  const { scriptPath, logPath } = createInternalMacInstallScript()
  const child = spawn('/bin/bash', [
    scriptPath,
    downloadedUpdateFile,
    appBundlePath,
    String(process.pid),
    logPath,
  ], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  setQuitting()
  app.quit()
  return true
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
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: getAppUpdateFeedUrl(),
  })

  autoUpdater.on('checking-for-update', () => {
    downloadedUpdateFile = null
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
    downloadedUpdateFile = info.downloadedFile
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
    logUpdateError('检查失败', error)
    setState({
      status: 'error',
      error: friendlyUpdateErrorMessage(),
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
    logUpdateError('检查异常', error)
    return setState({
      status: 'error',
      error: friendlyUpdateErrorMessage(),
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
  if (installDownloadedMacUpdateInternally()) {
    return
  }
  setQuitting()
  autoUpdater.quitAndInstall(false, true)
}
