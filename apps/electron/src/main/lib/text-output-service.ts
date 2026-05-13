/**
 * 语音输入文本输出服务
 */

import { BrowserWindow, clipboard } from 'electron'
import { VOICE_DICTATION_IPC_CHANNELS } from '../../types'
import type { VoiceDictationCommitResult, VoiceDictationSettings } from '../../types'
import { getMainWindow } from '../index'
import { pasteTextAtCurrentCursor } from './text-insertion-service'

let targetWasPromaInput = false

export function captureVoiceDictationTarget(forcePromaInput?: boolean): boolean {
  const mainWindow = getMainWindow()
  targetWasPromaInput = forcePromaInput ?? BrowserWindow.getFocusedWindow() === mainWindow

  if (!targetWasPromaInput && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
  }

  return targetWasPromaInput
}

export async function commitVoiceDictationText(
  text: string,
  settings: VoiceDictationSettings,
): Promise<VoiceDictationCommitResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { mode: 'clipboard', success: false, message: '没有可输出的语音文本' }
  }

  const mainWindow = getMainWindow()
  const shouldWriteProma =
    settings.outputMode === 'proma-input' ||
    (settings.outputMode === 'auto' && targetWasPromaInput)

  if (shouldWriteProma && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(VOICE_DICTATION_IPC_CHANNELS.INSERT_TEXT, { text: trimmed })
    return { mode: 'proma-input', success: true, message: '已写入输入框' }
  }

  if (settings.outputMode === 'auto') {
    const result = await pasteTextAtCurrentCursor(trimmed)
    return result.success
      ? { mode: 'cursor', success: true, message: result.message }
      : { mode: 'clipboard', success: true, message: result.message }
  }

  clipboard.writeText(trimmed)
  return { mode: 'clipboard', success: true, message: '已复制到剪贴板' }
}
