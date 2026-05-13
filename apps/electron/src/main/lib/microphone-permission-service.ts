/**
 * 麦克风权限服务
 */

import { systemPreferences } from 'electron'
import type { MicPermissionResult } from '../../types'

export function checkMicrophonePermission(): MicPermissionResult {
  const platform = process.platform

  if (platform === 'darwin') {
    const raw = systemPreferences.getMediaAccessStatus('microphone')
    const status: MicPermissionResult['status'] =
      raw === 'granted' || raw === 'denied' || raw === 'not-determined'
        ? raw
        : 'denied'
    return { status, platform }
  }

  return { status: 'unsupported', platform }
}

export async function requestMicrophonePermission(): Promise<MicPermissionResult> {
  const platform = process.platform

  if (platform === 'darwin') {
    const granted = await systemPreferences.askForMediaAccess('microphone')
    return { status: granted ? 'granted' : 'denied', platform }
  }

  return { status: 'unsupported', platform }
}
