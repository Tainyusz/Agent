/**
 * AboutSettings - 关于页面
 *
 * 显示应用版本号、运行时和本地环境检测。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { RefreshCw, Loader2, AlertCircle, Info, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import type { AppUpdateState, EnvironmentCheckResult, RuntimeStatus } from '@proma/shared'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from './primitives'
import {
  environmentCheckResultAtom,
  hasEnvironmentIssuesAtom,
} from '@/atoms/environment'
import { EnvironmentCheckCard } from '@/components/environment/EnvironmentCheckCard'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import wechatQrCode from '../../../../../../宇哥微信.jpg'

/** 从 package.json 构建时由 Vite define 注入 */
declare const __APP_VERSION__: string
const APP_VERSION = __APP_VERSION__
const UPDATE_FRIENDLY_ERROR = '哎呀，有点小问题 晚点再试试吧～'

function updateStatusText(state: AppUpdateState | null): string {
  if (!state) return '尚未检查'
  switch (state.status) {
    case 'checking':
      return '正在检查更新'
    case 'available':
      return `发现新版本 ${state.updateInfo?.version ?? ''}`.trim()
    case 'downloading':
      return `正在下载 ${Math.round(state.progress?.percent ?? 0)}%`
    case 'downloaded':
      return `新版本 ${state.updateInfo?.version ?? ''} 已下载`.trim()
    case 'not-available':
      return '当前已是最新版本'
    case 'error':
      return UPDATE_FRIENDLY_ERROR
    default:
      return '尚未检查'
  }
}

function AppUpdateCard(): React.ReactElement {
  const [state, setState] = React.useState<AppUpdateState | null>(null)
  const [isChecking, setIsChecking] = React.useState(false)

  React.useEffect(() => {
    let mounted = true
    window.electronAPI.getAppUpdateState().then((next) => {
      if (mounted) setState(next)
    }).catch(console.error)
    const cleanup = window.electronAPI.onAppUpdateStateChanged((next) => {
      setState(next)
    })
    return () => {
      mounted = false
      cleanup()
    }
  }, [])

  const isBusy = isChecking || state?.status === 'checking' || state?.status === 'downloading'
  const canInstall = state?.status === 'downloaded'
  const progress = Math.max(0, Math.min(100, state?.progress?.percent ?? 0))

  const handleCheck = async () => {
    setIsChecking(true)
    try {
      const next = await window.electronAPI.checkForAppUpdate(true)
      setState(next)
    } catch {
      toast.error(UPDATE_FRIENDLY_ERROR)
    } finally {
      setIsChecking(false)
    }
  }

  const handleInstall = async () => {
    try {
      await window.electronAPI.installDownloadedUpdate()
    } catch (error) {
      toast.error('安装更新失败', { description: String(error) })
    }
  }

  return (
    <SettingsCard>
      <div className="p-4 border-b">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">自动更新</h3>
            <p className="text-xs text-muted-foreground mt-1">
              新版本会自动下载，下载完成后重启应用安装。
            </p>
          </div>
          <button
            onClick={canInstall ? handleInstall : handleCheck}
            disabled={isBusy && !canInstall}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {isBusy && !canInstall ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {canInstall ? '重启安装' : isBusy ? '检查中...' : '检查更新'}
          </button>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <SettingsRow label="当前版本">
          <span className="text-sm text-muted-foreground font-mono">{APP_VERSION}</span>
        </SettingsRow>
        <SettingsRow label="更新状态">
          <span className="text-sm text-muted-foreground">{updateStatusText(state)}</span>
        </SettingsRow>
        {state?.status === 'downloading' && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </SettingsCard>
  )
}

/** 环境检测卡片 */
function EnvironmentCard(): React.ReactElement {
  const hasIssues = useAtomValue(hasEnvironmentIssuesAtom)
  const setEnvironmentResult = useSetAtom(environmentCheckResultAtom)
  const [result, setResult] = React.useState<EnvironmentCheckResult | null>(null)
  const [isChecking, setIsChecking] = React.useState(false)

  // 初始化时加载缓存的检测结果
  React.useEffect(() => {
    window.electronAPI.getSettings().then((settings) => {
      if (settings.lastEnvironmentCheck) {
        setResult(settings.lastEnvironmentCheck)
        setEnvironmentResult(settings.lastEnvironmentCheck)
      }
    })
  }, [])

  // 执行环境检测
  const handleCheck = async () => {
    setIsChecking(true)
    try {
      const checkResult = await window.electronAPI.checkEnvironment()
      setResult(checkResult)
      setEnvironmentResult(checkResult)
    } catch (error) {
      console.error('[环境检测] 检测失败:', error)
    } finally {
      setIsChecking(false)
    }
  }

  // Node.js 检测状态
  const nodejsStatus = !result
    ? 'checking'
    : result.nodejs.installed && result.nodejs.meetsMinimum
      ? result.nodejs.meetsRecommended
        ? 'success'
        : 'warning'
      : 'error'

  // Git 检测状态
  const gitStatus = !result
    ? 'checking'
    : result.git.installed && result.git.meetsRequirement
      ? 'success'
      : 'error'

  return (
    <SettingsCard>
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">环境检测</h3>
            {hasIssues && <Badge variant="destructive">!</Badge>}
          </div>
          <button
            onClick={handleCheck}
            disabled={isChecking}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {isChecking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {isChecking ? '检测中...' : '重新检查'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Agent 模式需要 Node.js 和 Git 支持
        </p>
      </div>

      <div className="p-4 space-y-3">
        {/* Node.js 检测卡片 */}
        <EnvironmentCheckCard
          name="Node.js"
          status={nodejsStatus}
          version={result?.nodejs.version}
          requirement="推荐 22 LTS，最低 18 LTS"
          action={{
            type: 'openExternal',
            url: result?.nodejs.downloadUrl || 'https://nodejs.org/',
          }}
          statusText={
            result && nodejsStatus === 'warning'
              ? `v${result.nodejs.version} (建议升级到 22 LTS 以获得最佳体验)`
              : undefined
          }
        />

        {/* Git 检测卡片 */}
        <EnvironmentCheckCard
          name="Git"
          status={gitStatus}
          version={result?.git.version}
          requirement="版本 >= 2.0"
          action={{
            type: 'openExternal',
            url: result?.git.downloadUrl || 'https://git-scm.com/',
          }}
        />

        {/* Windows 提示 */}
        {result?.platform === 'win32' && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>Windows 用户建议：</strong>
              安装时请选择默认路径（C:\Program Files\...），并确保勾选"添加到 PATH"选项
            </AlertDescription>
          </Alert>
        )}
      </div>
    </SettingsCard>
  )
}

/** Shell 环境卡片（Windows 平台）*/
function ShellEnvironmentCard(): React.ReactElement | null {
  const [runtimeStatus, setRuntimeStatus] = React.useState<RuntimeStatus | null>(null)
  const [isChecking, setIsChecking] = React.useState(false)

  // 初始化时加载运行时状态
  React.useEffect(() => {
    window.electronAPI.getRuntimeStatus().then((status) => {
      setRuntimeStatus(status)
    })
  }, [])

  // 重新检测
  const handleCheck = async () => {
    setIsChecking(true)
    try {
      // 触发重新初始化运行时（后续可以添加此 IPC 方法）
      const status = await window.electronAPI.getRuntimeStatus()
      setRuntimeStatus(status)
    } catch (error) {
      console.error('[Shell 环境检测] 检测失败:', error)
    } finally {
      setIsChecking(false)
    }
  }

  // 非 Windows 平台不显示
  if (!runtimeStatus || !runtimeStatus.shell) {
    return null
  }

  const { shell } = runtimeStatus
  const hasShell = shell.gitBash?.available || shell.wsl?.available

  return (
    <SettingsCard>
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Shell 环境（Windows）</h3>
            {!hasShell && <Badge variant="destructive">!</Badge>}
          </div>
          <button
            onClick={handleCheck}
            disabled={isChecking}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {isChecking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {isChecking ? '检测中...' : '重新检查'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Agent 模式需要 Git Bash 或 WSL 支持
        </p>
      </div>

      <div className="p-4 space-y-3">
        {/* Git Bash 检测卡片 */}
        <EnvironmentCheckCard
          name="Git Bash"
          status={shell.gitBash?.available ? 'success' : 'error'}
          version={shell.gitBash?.version ?? undefined}
          requirement="Git for Windows 自带"
          action={{ type: 'download', installerId: 'git-for-windows' }}
          statusText={
            shell.gitBash?.available
              ? `${shell.gitBash.path}`
              : shell.gitBash?.error || '未安装'
          }
        />

        {/* WSL 检测卡片 */}
        <EnvironmentCheckCard
          name="WSL"
          status={shell.wsl?.available ? 'success' : 'error'}
          version={shell.wsl?.version ? `WSL ${shell.wsl.version}` : undefined}
          requirement="WSL 1 或 WSL 2"
          action={{
            type: 'openExternal',
            url: 'https://learn.microsoft.com/zh-cn/windows/wsl/install',
          }}
          statusText={
            shell.wsl?.available
              ? `默认发行版: ${shell.wsl.defaultDistro || '未设置'} (${shell.wsl.distros.join(', ')})`
              : shell.wsl?.error || '未安装'
          }
        />

        {/* 推荐环境提示 */}
        {shell.recommended && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>当前使用：</strong>
              {shell.recommended === 'git-bash' ? 'Git Bash（推荐）' : 'WSL'}
            </AlertDescription>
          </Alert>
        )}

        {/* 无可用环境警告 */}
        {!hasShell && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>未检测到可用的 Shell 环境！</strong>
              <br />
              Agent 模式需要 Git Bash 或 WSL 才能运行。请安装其中之一后重启应用。
            </AlertDescription>
          </Alert>
        )}
      </div>
    </SettingsCard>
  )
}

/** 品牌与开发说明 */
function BrandAboutCard(): React.ReactElement {
  return (
    <SettingsCard divided={false}>
      <div className="p-6 flex flex-col items-center gap-5 text-center">
        <p className="text-sm leading-7 text-muted-foreground max-w-lg whitespace-pre-line">
          {'无限轻松是 Agent 时代的先驱项目\n现在无限轻松每周都会更新\n有问题反馈可扫码联系宇哥'}
        </p>

        <div className="flex flex-col items-center gap-2.5">
          <img
            src={wechatQrCode}
            alt="宇哥微信二维码"
            className="h-40 w-40 rounded-xl border border-border object-contain bg-white"
          />
          <span className="text-xs text-muted-foreground">扫码添加宇哥微信</span>
        </div>
      </div>
    </SettingsCard>
  )
}

export function AboutSettings(): React.ReactElement {
  return (
    <SettingsSection
      title="关于无限轻松"
      description="集成通用 AI Agent 的下一代人工智能软件"
    >
      <SettingsCard>
        <SettingsRow label="版本">
          <span className="text-sm text-muted-foreground font-mono">{APP_VERSION}</span>
        </SettingsRow>
        <SettingsRow label="运行时">
          <span className="text-sm text-muted-foreground">Electron + React</span>
        </SettingsRow>
      </SettingsCard>

      <AppUpdateCard />

      {/* 环境检测卡片 */}
      <EnvironmentCard />

      {/* Shell 环境卡片（仅 Windows） */}
      <ShellEnvironmentCard />

      <BrandAboutCard />
    </SettingsSection>
  )
}
