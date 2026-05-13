/**
 * 自定义语音转写服务
 *
 * 支持两种调用方式：
 * 1. 上传录音文件到 /api/transcribe
 * 2. 传入音频 URL 到 /api/transcribe
 */

import type {
  VoiceDictationSegment,
  VoiceDictationTranscribeAudioInput,
  VoiceDictationTranscribeResult,
  VoiceDictationTranscribeUrlInput,
} from '../../types'

const TRANSCRIBE_ENDPOINT = 'https://watq.wxqsai.com:35667/api/transcribe'
const TRANSCRIBE_TOKEN = 'sk-7ofxbq7sy9u7pmgg8bllkdo76w7dbag5'

interface RawTranscribeResponse {
  code?: number
  duration?: number
  text?: unknown
  segments?: unknown
  message?: unknown
  error?: unknown
}

export async function testCustomTranscribeConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(TRANSCRIBE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TRANSCRIBE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: '' }),
    })
    if (response.status === 400 || response.status === 422) {
      return { success: true, message: '连接正常，等待有效音频输入' }
    }
    if (!response.ok) {
      return { success: false, message: `连接失败: HTTP ${response.status}` }
    }
    return { success: true, message: '连接正常' }
  } catch (error) {
    return { success: false, message: getErrorMessage(error) }
  }
}

export async function transcribeVoiceAudio(input: VoiceDictationTranscribeAudioInput): Promise<VoiceDictationTranscribeResult> {
  if (!input.data || input.data.byteLength === 0) {
    throw new Error('没有可转写的音频数据')
  }

  const mimeType = input.mimeType || 'audio/webm'
  const filename = input.filename || `voice-${input.sessionId}.${extensionFromMimeType(mimeType)}`
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(input.data)], { type: mimeType }), filename)

  const response = await fetch(TRANSCRIBE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TRANSCRIBE_TOKEN}`,
    },
    body: form,
  })

  return parseTranscribeResponse(response)
}

export async function transcribeVoiceUrl(input: VoiceDictationTranscribeUrlInput): Promise<VoiceDictationTranscribeResult> {
  const url = input.url.trim()
  if (!url) throw new Error('音频 URL 不能为空')

  const response = await fetch(TRANSCRIBE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TRANSCRIBE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  })

  return parseTranscribeResponse(response)
}

async function parseTranscribeResponse(response: Response): Promise<VoiceDictationTranscribeResult> {
  const rawText = await response.text()
  let raw: RawTranscribeResponse
  try {
    raw = JSON.parse(rawText) as RawTranscribeResponse
  } catch {
    throw new Error(`转写服务返回非 JSON: ${rawText.slice(0, 200)}`)
  }

  if (!response.ok || raw.code !== 200) {
    const message = typeof raw.message === 'string'
      ? raw.message
      : typeof raw.error === 'string'
        ? raw.error
        : rawText.slice(0, 200)
    throw new Error(`转写失败: ${message}`)
  }

  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  const segments = normalizeSegments(raw.segments) ?? []
  const fallbackText = segments.map((segment) => segment.text).join('')
  const finalText = text || fallbackText
  if (!finalText) throw new Error('转写服务没有返回文本')

  return {
    text: finalText,
    duration: typeof raw.duration === 'number' ? raw.duration : undefined,
    segments: segments.length > 0 ? segments : undefined,
  }
}

function normalizeSegments(value: unknown): VoiceDictationSegment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const segments: VoiceDictationSegment[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const segment = item as Record<string, unknown>
    const text = typeof segment.text === 'string' ? segment.text : ''
    const start = typeof segment.start === 'number' ? segment.start : 0
    const end = typeof segment.end === 'number' ? segment.end : start
    const speaker = typeof segment.speaker === 'number' ? segment.speaker : undefined
    if (text) segments.push({ start, end, text, speaker })
  }
  return segments.length > 0 ? segments : undefined
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
