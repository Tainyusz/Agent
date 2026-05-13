/**
 * VoiceInputSettings — 语音输入设置
 */

import * as React from 'react'
import { Loader2, TestTube2, Mic, MicOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsToggle,
} from './primitives'
import type { VoiceDictationSettings, MicPermissionResult } from '../../../types'

const OUTPUT_OPTIONS = [
  { value: 'auto', label: '自动：无限轻松激活时写入对话框，否则写入当前光标' },
  { value: 'clipboard', label: '仅复制到剪贴板' },
  { value: 'proma-input', label: '仅写入无限轻松输入框' },
]

export function VoiceInputSettings(): React.ReactElement {
  const [settings, setSettings] = React.useState<VoiceDictationSettings | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [micPermission, setMicPermission] = React.useState<MicPermissionResult | null>(null)
  const [requestingPermission, setRequestingPermission] = React.useState(false)

  const refreshMicPermission = React.useCallback(async () => {
    try {
      const result = await window.electronAPI.checkMicrophonePermission()
      setMicPermission(result)
    } catch (error) {
      console.error('[语音输入] 检查麦克风权限失败:', error)
    }
  }, [])

  React.useEffect(() => {
    window.electronAPI.getVoiceDictationSettings()
      .then(setSettings)
      .catch((error) => {
        console.error('[语音输入] 加载设置失败:', error)
        toast.error('加载语音输入设置失败')
      })
    refreshMicPermission()
  }, [refreshMicPermission])

  const handleRequestMicPermission = React.useCallback(async () => {
    setRequestingPermission(true)
    try {
      const result = await window.electronAPI.requestMicrophonePermission()
      setMicPermission(result)
      if (result.status === 'granted') {
        toast.success('麦克风权限已授权')
      } else if (result.status === 'denied') {
        toast.error('麦克风权限已被拒绝，请在系统设置中允许')
      }
    } catch (error) {
      console.error('[语音输入] 请求麦克风权限失败:', error)
      toast.error('请求麦克风权限失败')
    } finally {
      setRequestingPermission(false)
    }
  }, [])

  const update = React.useCallback(async (updates: Partial<VoiceDictationSettings>) => {
    if (!settings) return
    const optimistic = { ...settings, ...updates, provider: 'custom' as const }
    setSettings(optimistic)
    setSaving(true)
    try {
      const saved = await window.electronAPI.updateVoiceDictationSettings(optimistic)
      setSettings(saved)
      window.electronAPI.reregisterGlobalShortcuts().catch(console.error)
    } catch (error) {
      console.error('[语音输入] 保存设置失败:', error)
      toast.error('保存语音输入设置失败')
    } finally {
      setSaving(false)
    }
  }, [settings])

  const handleTest = React.useCallback(async () => {
    setTesting(true)
    try {
      const result = await window.electronAPI.testVoiceDictationConnection()
      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error(`测试连接失败: ${message}`)
    } finally {
      setTesting(false)
    }
  }, [])

  if (!settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在加载语音输入设置...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="自定义语音输入"
        description="使用内置转写接口，按全局快捷键唤起浮窗，停止后自动识别并写入当前输入位置。"
        action={
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <TestTube2 className="mr-1.5 size-3.5" />}
            测试连接
          </Button>
        }
      >
        {micPermission && (
          <div className="rounded-lg border px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {micPermission.status === 'granted' ? (
                  <Mic className="size-4 text-green-500" />
                ) : micPermission.status === 'denied' ? (
                  <MicOff className="size-4 text-destructive" />
                ) : (
                  <Mic className="size-4 text-amber-500" />
                )}
                <div>
                  <span className="font-medium text-foreground">麦克风权限</span>
                  <span className="ml-2 text-muted-foreground">
                    {micPermission.status === 'granted'
                      ? '已授权，语音输入可正常使用'
                      : micPermission.status === 'denied'
                        ? '已被系统阻止，请在系统设置中允许无限轻松访问麦克风'
                        : micPermission.status === 'not-determined'
                          ? '未授权，使用语音输入前需要先授权'
                          : '当前系统不支持预检，录音时将自动弹出权限请求'}
                  </span>
                </div>
              </div>
              {(micPermission.status === 'not-determined' || micPermission.status === 'denied') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRequestMicPermission}
                  disabled={requestingPermission}
                >
                  {requestingPermission ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : micPermission.status === 'not-determined' ? (
                    <Mic className="mr-1.5 size-3.5" />
                  ) : (
                    <MicOff className="mr-1.5 size-3.5" />
                  )}
                  {micPermission.status === 'not-determined' ? '允许麦克风权限' : '重新请求权限'}
                </Button>
              )}
            </div>
          </div>
        )}

        <SettingsCard>
          <SettingsToggle
            label="启用语音输入"
            description="启用后可使用 Ctrl+～ 打开语音输入浮窗，再按一次停止。"
            checked={settings.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
          />
          <SettingsSelect
            label="输出方式"
            description="默认写入当前光标位置；如果唤起时无限轻松是当前激活窗口，会写入当前 Chat 或 Agent 输入框。"
            value={settings.outputMode}
            onValueChange={(outputMode) => update({ outputMode: outputMode as VoiceDictationSettings['outputMode'] })}
            options={OUTPUT_OPTIONS}
          />
        </SettingsCard>
      </SettingsSection>

      {saving && (
        <p className="text-xs text-muted-foreground">正在保存语音输入设置...</p>
      )}
    </div>
  )
}
