/**
 * 语音输入设置服务
 *
 * 当前按用户要求使用内置自定义转写服务，不在设置页暴露凭据。
 */

import type { VoiceDictationSettings, VoiceDictationSettingsUpdate } from '../../types'
import { getSettings, updateSettings } from './settings-service'

const DEFAULT_VOICE_DICTATION_SETTINGS: VoiceDictationSettings = {
  enabled: true,
  provider: 'custom',
  appId: '',
  accessToken: '',
  resourceId: '',
  language: '',
  endpointMode: 'async',
  outputMode: 'auto',
  customHotwords: '',
}

function loadInitialSettings(): VoiceDictationSettings {
  const persisted = getSettings().voiceDictation ?? {}
  return {
    ...DEFAULT_VOICE_DICTATION_SETTINGS,
    ...persisted,
    provider: 'custom',
    appId: '',
    accessToken: '',
    resourceId: '',
    language: '',
    endpointMode: 'async',
    customHotwords: '',
  }
}

let currentSettings: VoiceDictationSettings = loadInitialSettings()

export function getVoiceDictationSettings(): VoiceDictationSettings {
  return currentSettings
}

export function updateVoiceDictationSettings(updates: VoiceDictationSettingsUpdate): VoiceDictationSettings {
  currentSettings = {
    ...currentSettings,
    ...updates,
    enabled: updates.enabled ?? currentSettings.enabled,
    provider: 'custom',
    appId: '',
    accessToken: '',
    resourceId: '',
    language: '',
    endpointMode: 'async',
    customHotwords: '',
  }
  updateSettings({
    voiceDictation: {
      enabled: currentSettings.enabled,
      provider: 'custom',
      outputMode: currentSettings.outputMode,
    },
  })
  return currentSettings
}
