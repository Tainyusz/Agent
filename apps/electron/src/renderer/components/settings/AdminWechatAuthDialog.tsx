import * as React from 'react'
import { Loader2, QrCode, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const ADMIN_AUTH_BASE_URL = 'https://aichat.wxqsai.com'
const LOGIN_POLL_DELAY_MS = 2000

export interface AdminWechatAuthResult {
  token: string
  openid?: string
  scene: string
}

interface AdminWechatAuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAuthenticated: (result: AdminWechatAuthResult) => void
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text) return {}

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

function getString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getErrorMessage(data: Record<string, unknown>, fallback: string): string {
  return getString(data, 'error')
    ?? getString(data, 'errmsg')
    ?? getString(data, 'message')
    ?? fallback
}

function getTerminalError(data: Record<string, unknown>): string | null {
  const status = getString(data, 'status')
  if (status !== 'denied' && status !== 'failed' && status !== 'error') return null

  return getErrorMessage(data, '管理员授权未通过')
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function AdminWechatAuthDialog({
  open,
  onOpenChange,
  onAuthenticated,
}: AdminWechatAuthDialogProps): React.ReactElement {
  const [qrCode, setQrCode] = React.useState<string | null>(null)
  const [scene, setScene] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pollNotice, setPollNotice] = React.useState<string | null>(null)
  const [refreshKey, setRefreshKey] = React.useState(0)

  React.useEffect(() => {
    if (!open) {
      setQrCode(null)
      setScene(null)
      setLoading(false)
      setError(null)
      setPollNotice(null)
      return
    }

    let cancelled = false
    const controller = new AbortController()

    async function loadQrCode(): Promise<void> {
      setLoading(true)
      setQrCode(null)
      setScene(null)
      setError(null)
      setPollNotice(null)

      try {
        const url = new URL('/get_qrcode', ADMIN_AUTH_BASE_URL)
        url.searchParams.set('purpose', 'admin')

        const response = await fetch(url.toString(), {
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await readJson(response)

        if (!response.ok) {
          throw new Error(getErrorMessage(data, '获取二维码失败'))
        }

        const nextScene = getString(data, 'scene')
        const nextQrCode = getString(data, 'qrcode')

        if (!nextScene || !nextQrCode) {
          throw new Error('二维码接口返回数据不完整')
        }

        if (cancelled) return
        setScene(nextScene)
        setQrCode(nextQrCode)
      } catch (err) {
        if (cancelled || isAbortError(err)) return
        setError(err instanceof Error ? err.message : '获取二维码失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadQrCode()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [open, refreshKey])

  React.useEffect(() => {
    if (!open || !scene) return

    const currentScene = scene
    let stopped = false
    let timeoutId: number | undefined
    const controller = new AbortController()

    async function pollLoginStatus(): Promise<void> {
      if (stopped) return

      try {
        const url = new URL('/check_login', ADMIN_AUTH_BASE_URL)
        url.searchParams.set('scene', currentScene)

        const response = await fetch(url.toString(), {
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await readJson(response)

        if (!response.ok) {
          setError(getErrorMessage(data, '检查登录状态失败'))
          return
        }

        const terminalError = getTerminalError(data)
        if (terminalError) {
          stopped = true
          setError(terminalError)
          return
        }

        if (getString(data, 'status') === 'success') {
          const token = getString(data, 'token')
          if (!token) {
            setError('授权成功，但后端没有返回 token')
            return
          }

          stopped = true
          toast.success('管理员授权通过')
          onAuthenticated({
            token,
            openid: getString(data, 'openid'),
            scene: currentScene,
          })
          return
        }

        setPollNotice(null)
      } catch (err) {
        if (!stopped && !isAbortError(err)) {
          setPollNotice('暂时无法连接授权服务器，正在重试')
        }
      }

      if (!stopped) {
        timeoutId = window.setTimeout(pollLoginStatus, LOGIN_POLL_DELAY_MS)
      }
    }

    timeoutId = window.setTimeout(pollLoginStatus, 600)

    return () => {
      stopped = true
      controller.abort()
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [open, scene, onAuthenticated])

  const handleRefresh = (): void => {
    setRefreshKey((value) => value + 1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            管理员授权
          </DialogTitle>
          <DialogDescription>
            进入模型配置前，需要管理员使用微信扫码确认。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="flex h-[232px] w-[232px] items-center justify-center rounded-lg border bg-white p-3">
            {loading ? (
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            ) : qrCode ? (
              <img src={qrCode} alt="管理员微信授权二维码" className="h-full w-full object-contain" />
            ) : (
              <QrCode className="h-10 w-10 text-muted-foreground" />
            )}
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {scene ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <QrCode className="h-4 w-4" />
            )}
            <span>{scene ? '请使用管理员微信扫码' : '正在生成授权二维码...'}</span>
          </div>

          {(error || pollNotice) && (
            <div className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {error ?? pollNotice}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="secondary" onClick={handleRefresh} disabled={loading}>
            <RefreshCw size={14} />
            <span>刷新二维码</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
