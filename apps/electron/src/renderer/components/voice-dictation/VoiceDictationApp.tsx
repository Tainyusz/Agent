/**
 * VoiceDictationApp — 系统级语音输入浮窗
 */

import * as React from 'react'
import { Check, Clipboard, Loader2, Mic, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { VoiceDictationCommitResult, VoiceDictationStateEvent } from '../../../types'
import { useVoiceWindowLayout } from './use-voice-window-layout'

const WAV_PROCESSOR_BUFFER_SIZE = 4096

export function VoiceDictationApp(): React.ReactElement {
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<VoiceDictationStateEvent['status']>('idle')
  const [message, setMessage] = React.useState('按快捷键开始语音输入')
  const [transcript, setTranscript] = React.useState('')
  const [commitResult, setCommitResult] = React.useState<VoiceDictationCommitResult | null>(null)
  const [volume, setVolume] = React.useState(0)

  const sessionIdRef = React.useRef<string | null>(null)
  const transcriptRef = React.useRef('')
  const streamRef = React.useRef<MediaStream | null>(null)
  const audioContextRef = React.useRef<AudioContext | null>(null)
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null)
  const audioProcessorRef = React.useRef<ScriptProcessorNode | null>(null)
  const silentGainRef = React.useRef<GainNode | null>(null)
  const analyserFrameRef = React.useRef<number | null>(null)
  const wavChunksRef = React.useRef<Float32Array[]>([])
  const wavSampleRateRef = React.useRef(44_100)
  const wavSampleLengthRef = React.useRef(0)
  const stoppingRef = React.useRef(false)
  const cancelledRef = React.useRef(false)
  const commitInFlightRef = React.useRef(false)

  const {
    rootRef,
    panelRef,
    headerRef,
    hintBarRef,
    transcriptBoxRef,
    transcriptMaxHeight,
  } = useVoiceWindowLayout({
    commitResultMessage: commitResult?.message ?? null,
    message,
    status,
    transcript,
  })

  React.useEffect(() => {
    document.body.style.background = 'hsl(var(--background))'
    document.documentElement.style.background = 'hsl(var(--background))'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.margin = '0'
    document.body.style.padding = '0'
  }, [])

  const cleanupAudio = React.useCallback(() => {
    if (analyserFrameRef.current !== null) {
      cancelAnimationFrame(analyserFrameRef.current)
      analyserFrameRef.current = null
    }
    sourceRef.current?.disconnect()
    sourceRef.current = null
    if (audioProcessorRef.current) {
      audioProcessorRef.current.onaudioprocess = null
      audioProcessorRef.current.disconnect()
      audioProcessorRef.current = null
    }
    silentGainRef.current?.disconnect()
    silentGainRef.current = null
    audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setVolume(0)
  }, [])

  const commitAndHide = React.useCallback(async (textOverride?: string) => {
    if (commitInFlightRef.current) return
    commitInFlightRef.current = true

    const text = (textOverride ?? transcriptRef.current).trim()
    if (!text) {
      setStatus('idle')
      setMessage('没有识别到语音内容')
      cleanupAudio()
      setTimeout(() => window.electronAPI.hideVoiceDictation().catch(console.error), 220)
      return
    }

    setStatus('stopping')
    setMessage('正在输出文本...')
    try {
      const result = await window.electronAPI.commitVoiceDictation({ text })
      setCommitResult(result)
      setStatus('completed')
      setMessage(result.message)
      cleanupAudio()
      setTimeout(() => window.electronAPI.hideVoiceDictation().catch(console.error), 320)
    } catch (error) {
      commitInFlightRef.current = false
      const textMessage = error instanceof Error ? error.message : '未知错误'
      setStatus('error')
      setMessage(`输出失败: ${textMessage}`)
    }
  }, [cleanupAudio])

  const transcribeAndCommit = React.useCallback(async (currentSessionId: string) => {
    const chunks = wavChunksRef.current
    const sampleRate = wavSampleRateRef.current
    const sampleLength = wavSampleLengthRef.current
    wavChunksRef.current = []
    wavSampleLengthRef.current = 0
    cleanupAudio()

    if (cancelledRef.current || sessionIdRef.current !== currentSessionId) return

    if (chunks.length === 0 || sampleLength === 0) {
      setStatus('error')
      setMessage('没有录到音频')
      return
    }

    setStatus('stopping')
    setMessage('正在识别...')
    try {
      const data = encodeWav(chunks, sampleLength, sampleRate)
      const result = await window.electronAPI.transcribeVoiceDictationAudio({
        sessionId: currentSessionId,
        data,
        mimeType: 'audio/wav',
        filename: `voice-${currentSessionId}.wav`,
      })
      const text = result.text.trim()
      setTranscript(text)
      transcriptRef.current = text
      await commitAndHide(text)
    } catch (error) {
      commitInFlightRef.current = false
      const textMessage = getReadableErrorMessage(error)
      setStatus('error')
      setMessage(`识别失败: ${textMessage}`)
    }
  }, [cleanupAudio, commitAndHide])

  const stopRecording = React.useCallback(async () => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStatus('stopping')
    setMessage('正在收尾识别...')

    const currentSessionId = sessionIdRef.current
    if (currentSessionId) {
      await transcribeAndCommit(currentSessionId)
    }
  }, [transcribeAndCommit])

  const cancelAndHide = React.useCallback(() => {
    cancelledRef.current = true
    stoppingRef.current = true
    cleanupAudio()
    window.electronAPI.hideVoiceDictation().catch(console.error)
  }, [cleanupAudio])

  const startAudioCapture = React.useCallback((stream: MediaStream) => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    const audioContext = new AudioContextCtor()
    audioContextRef.current = audioContext
    wavSampleRateRef.current = audioContext.sampleRate
    const source = audioContext.createMediaStreamSource(stream)
    sourceRef.current = source
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)

    const processor = audioContext.createScriptProcessor(WAV_PROCESSOR_BUFFER_SIZE, 1, 1)
    audioProcessorRef.current = processor
    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0
    silentGainRef.current = silentGain

    processor.onaudioprocess = (event) => {
      if (cancelledRef.current || stoppingRef.current) return
      const input = event.inputBuffer.getChannelData(0)
      const copy = new Float32Array(input.length)
      copy.set(input)
      wavChunksRef.current.push(copy)
      wavSampleLengthRef.current += copy.length
    }

    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(audioContext.destination)

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {})
    }

    const data = new Uint8Array(analyser.fftSize)

    const tick = (): void => {
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (let i = 0; i < data.length; i += 1) {
        peak = Math.max(peak, Math.abs((data[i] ?? 128) - 128) / 128)
      }
      setVolume(Math.min(1, peak * 3.8))
      analyserFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [])

  const startRecording = React.useCallback(async () => {
    cancelledRef.current = false
    stoppingRef.current = false
    commitInFlightRef.current = false
    wavChunksRef.current = []
    wavSampleLengthRef.current = 0
    setTranscript('')
    transcriptRef.current = ''
    setCommitResult(null)
    setStatus('recording')
    setMessage('请开始说话')

    const permission = await window.electronAPI.checkMicrophonePermission()
    if (permission.status === 'denied') {
      setStatus('error')
      setMessage('麦克风权限已被系统阻止，请在系统设置中允许无限轻松访问麦克风')
      return
    }
    if (permission.status === 'not-determined') {
      const requested = await window.electronAPI.requestMicrophonePermission()
      if (requested.status !== 'granted') {
        setStatus('error')
        setMessage('需要麦克风权限才能使用语音输入')
        return
      }
    }

    const nextSessionId = crypto.randomUUID()
    setSessionId(nextSessionId)
    sessionIdRef.current = nextSessionId

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream
      startAudioCapture(stream)
      setStatus('recording')
      setMessage('正在听写')
    } catch (error) {
      cleanupAudio()
      const textMessage = error instanceof Error ? error.message : '未知错误'
      setStatus('error')
      setMessage(textMessage)
    }
  }, [cleanupAudio, startAudioCapture])

  React.useEffect(() => {
    const cleanupShown = window.electronAPI.onVoiceDictationShown(() => {
      startRecording().catch((error) => {
        const textMessage = error instanceof Error ? error.message : '未知错误'
        setStatus('error')
        setMessage(textMessage)
        cleanupAudio()
      })
    })

    const cleanupStop = window.electronAPI.onVoiceDictationToggleStop(() => {
      stopRecording().catch(console.error)
    })

    return () => {
      cleanupShown()
      cleanupStop()
      cleanupAudio()
    }
  }, [cleanupAudio, startRecording, stopRecording])

  const busy = status === 'connecting' || status === 'recording' || status === 'stopping'
  return (
    <div ref={rootRef} className="box-border flex h-screen w-screen flex-col overflow-hidden rounded-xl bg-background px-2 pt-2 pb-1.5">
      <div ref={panelRef} className="flex min-h-0 w-full flex-col overflow-hidden">
        <div ref={headerRef} className="voice-dictation-drag-region flex shrink-0 items-center justify-between px-2 pt-0.5 pb-2">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`relative flex size-8 items-center justify-center rounded-full ${status === 'error' ? 'bg-destructive/12 text-destructive' : 'bg-primary/12 text-primary'}`}
            >
              {status === 'connecting' || status === 'stopping'
                ? <Loader2 className="size-4 animate-spin" />
                : status === 'completed'
                  ? <Check className="size-4" />
                  : status === 'recording'
                    ? (
                      <div className="flex items-center gap-[3px] h-4">
                        {[0.6, 1, 0.75, 0.9, 0.5].map((scale, i) => (
                          <span
                            key={i}
                            className="w-[3px] rounded-full bg-primary transition-all duration-100"
                            style={{ height: `${Math.max(4, Math.round(volume * scale * 16))}px` }}
                          />
                        ))}
                      </div>
                    )
                    : <Mic className="size-4" />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">无限轻松语音输入</div>
              <div className="truncate text-xs text-muted-foreground">{message}</div>
            </div>
          </div>

          <div className="voice-dictation-no-drag flex items-center gap-1.5">
            {busy && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="voice-dictation-no-drag size-8 rounded-full text-destructive"
                onClick={() => stopRecording().catch(console.error)}
              >
                <Square className="size-3.5" fill="currentColor" strokeWidth={0} />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="voice-dictation-no-drag size-8 rounded-full text-muted-foreground"
              onClick={cancelAndHide}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 px-2">
          <div className="overflow-hidden rounded-lg bg-muted/45">
            <div ref={hintBarRef} className="flex min-h-8 shrink-0 items-center justify-between gap-3 px-3 py-1.5 text-xs leading-4 text-muted-foreground">
              <span className="truncate">
                Ctrl+～ 停止 · 外部写入光标 · 无限轻松激活时写入 Chat / Agent
              </span>
              {commitResult && (
                <span className="flex shrink-0 items-center gap-1.5">
                  <Clipboard className="size-3.5" />
                  {commitResult.message}
                </span>
              )}
            </div>
            <div className="h-px bg-border/70" />
            <div
              ref={transcriptBoxRef}
              className="box-border min-h-[34px] px-3 pt-2.5 pb-2.5 text-[15px] leading-7 text-foreground [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              style={{
                maxHeight: transcriptMaxHeight ?? undefined,
                overflowY: 'auto',
              }}
            >
              <div className="whitespace-pre-wrap break-words overflow-hidden">
                {transcript || (
                  <span className="text-muted-foreground/60">
                    {status === 'idle' ? '等待 Ctrl+～ 唤起' : '请开始说话'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function encodeWav(chunks: Float32Array[], sampleLength: number, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + sampleLength * 2)
  const view = new DataView(buffer)

  writeAsciiString(view, 0, 'RIFF')
  view.setUint32(4, 36 + sampleLength * 2, true)
  writeAsciiString(view, 8, 'WAVE')
  writeAsciiString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAsciiString(view, 36, 'data')
  view.setUint32(40, sampleLength * 2, true)

  let offset = 44
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i] ?? 0))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return buffer
}

function writeAsciiString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
}

function getReadableErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method 'voice-dictation:[^']+':\s*/, '')
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}
