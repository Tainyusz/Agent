/**
 * Chat 分享服务
 *
 * 将本地对话转换为 open.wxqsai.com 展示页使用的 JSON 结构，并上传生成公开链接。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { listConversations, getConversationMessages } from './conversation-manager'
import { getAgentSessionMeta, getAgentSessionSDKMessages } from './agent-session-manager'
import { getMimeType, readAttachmentAsBase64 } from './attachment-service'
import { getUserProfile } from './user-profile-service'
import type {
  ChatMessage,
  ChatShareResult,
  FileAttachment,
  SDKAssistantMessage,
  SDKContentBlock,
  SDKMessage,
  SDKTextBlock,
  SDKToolResultBlock,
  SDKUserContentBlock,
  SDKUserMessage,
} from '@proma/shared'

const SHARE_UPLOAD_URL = 'https://open.wxqsai.com/api/upload'
const SHARE_PUBLIC_BASE_URL = 'https://open.wxqsai.com/'
const IMAGE_PATH_PATTERN = /\/Users\/[^\r\n"'<>]*?\.(?:png|jpe?g|gif|webp)\b/gi
const ATTACHED_FILES_BLOCK_PATTERN = /<attached_files>[\s\S]*?<\/attached_files>/gi

interface ShareUser {
  name: string
  avatar: string
}

interface ShareAttachment {
  id: string
  filename: string
  mediaType: string
  size: number
  data?: string
}

interface ShareMessage {
  id: string
  role: ChatMessage['role']
  content: string
  createdAt: number
  time: string
  model?: string
  modelAvatar?: string
  user?: ShareUser
  reasoning?: string
  stopped?: boolean
  error?: string
  attachments?: ShareAttachment[]
}

const MODEL_ICON_MAP: Array<[RegExp, string]> = [
  [/gpt-5\.1-codex-mini/i, 'gpt-5.1-codex-mini.png'],
  [/gpt-5\.1-codex/i, 'gpt-5.1-codex.png'],
  [/gpt-5\.1-chat/i, 'gpt-5.1-chat.png'],
  [/gpt-5\.1/i, 'gpt-5.1.png'],
  [/gpt-5-codex/i, 'gpt-5-codex.png'],
  [/gpt-5-mini/i, 'gpt-5-mini.png'],
  [/gpt-5-nano/i, 'gpt-5-nano.png'],
  [/gpt-5-chat/i, 'gpt-5-chat.png'],
  [/gpt-5/i, 'gpt-5.png'],
  [/gpt-image/i, 'gpt_image_1.png'],
  [/gpt-4/i, 'gpt_4.png'],
  [/gpt-3/i, 'gpt_3.5.png'],
  [/\bo[134]\b/i, 'gpt_o1.png'],
  [/gpts|openai/i, 'openai.png'],
  [/claude|anthropic-/i, 'claude.png'],
  [/deepseek/i, 'deepseek.png'],
  [/deepgemini/i, 'deepgemini.png'],
  [/kimigemini/i, 'kimigemini.png'],
  [/qwengemini/i, 'qwengemini.png'],
  [/seedgemini/i, 'seedgemini.png'],
  [/gemma/i, 'gemma.png'],
  [/veo|gemini/i, 'gemini.png'],
  [/qwen|qwq|qvq|wan-/i, 'qwen.png'],
  [/grok/i, 'grok.png'],
  [/moonshot|kimi/i, 'moonshot.png'],
  [/doubao|ep-202|seed/i, 'doubao.png'],
  [/zhipu|cogview|glm/i, 'zhipu.png'],
  [/chatglm/i, 'chatglm.png'],
  [/llama/i, 'llama.png'],
  [/codestral/i, 'codestral.png'],
  [/mixtral|mistral|ministral|magistral/i, 'mixtral.png'],
  [/yi-/i, 'yi.png'],
  [/ernie-|tao-/i, 'wenxin.png'],
  [/hunyuan/i, 'hunyuan.png'],
  [/sparkdesk|generalv/i, 'sparkdesk.png'],
  [/step/i, 'step.png'],
  [/minimax/i, 'minimax.png'],
  [/cohere|command/i, 'cohere.png'],
  [/text-embedding|embedding/i, 'embedding.png'],
  [/proma/i, 'proma.png'],
]

const modelAvatarCache = new Map<string, string | undefined>()

function formatShareTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function buildPublicUrl(id: string): string {
  const url = new URL(SHARE_PUBLIC_BASE_URL)
  url.searchParams.set('id', id)
  return url.toString()
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toEmojiAvatarDataUrl(avatar: string): string {
  const safeAvatar = escapeXml(avatar || '用户')
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">',
    '<rect width="96" height="96" rx="48" fill="#f3f4f6"/>',
    '<text x="48" y="56" text-anchor="middle" font-size="42" font-family="Apple Color Emoji, Segoe UI Emoji, sans-serif">',
    safeAvatar,
    '</text>',
    '</svg>',
  ].join('')

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function normalizeUserAvatar(avatar: string): string {
  if (/^(data:image\/|https?:\/\/)/i.test(avatar)) {
    return avatar
  }
  return toEmojiAvatarDataUrl(avatar)
}

function getShareUserProfile(): ShareUser {
  const profile = getUserProfile()
  return {
    name: profile.userName,
    avatar: normalizeUserAvatar(profile.avatar),
  }
}

function getModelIconDirs(): string[] {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const dirs = [
    resourcesPath ? join(resourcesPath, 'model-icons') : undefined,
    join(process.cwd(), 'src/renderer/assets/models'),
    join(process.cwd(), 'apps/electron/src/renderer/assets/models'),
    resolve(__dirname, '../src/renderer/assets/models'),
  ].filter((dir): dir is string => Boolean(dir))

  return Array.from(new Set(dirs))
}

function readModelAvatarDataUrl(filename: string): string | undefined {
  if (modelAvatarCache.has(filename)) {
    return modelAvatarCache.get(filename)
  }

  for (const dir of getModelIconDirs()) {
    const filePath = join(dir, filename)
    if (!existsSync(filePath)) continue

    try {
      const dataUrl = `data:image/png;base64,${readFileSync(filePath).toString('base64')}`
      modelAvatarCache.set(filename, dataUrl)
      return dataUrl
    } catch (error) {
      console.warn('[Chat 分享] 读取模型头像失败，已尝试下一个路径:', filePath, error)
    }
  }

  if (filename !== 'default.png') {
    const fallback = readModelAvatarDataUrl('default.png')
    modelAvatarCache.set(filename, fallback)
    return fallback
  }

  modelAvatarCache.set(filename, undefined)
  return undefined
}

function resolveModelAvatar(model?: string): string | undefined {
  const filename = MODEL_ICON_MAP.find(([regex]) => regex.test(model ?? ''))?.[1] ?? 'default.png'
  return readModelAvatarDataUrl(filename)
}

function makeStableId(input: string): string {
  return Buffer.from(input).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40)
}

function stripAttachedFilesBlocks(content: string): string {
  return content.replace(ATTACHED_FILES_BLOCK_PATTERN, '').trim()
}

function isImagePath(localPath: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(localPath.trim())
}

function cleanExtractedPath(localPath: string): string {
  return localPath.trim().replace(/[),.;，。]+$/g, '')
}

function serializeLocalImageAttachment(localPath: string, filename?: string): ShareAttachment | null {
  const cleanedPath = cleanExtractedPath(localPath)
  if (!isImagePath(cleanedPath) || !existsSync(cleanedPath)) return null

  try {
    const mediaType = getMimeType(extname(cleanedPath))
    if (!mediaType.startsWith('image/')) return null

    return {
      id: `local-image-${makeStableId(cleanedPath)}`,
      filename: filename?.trim() || basename(cleanedPath),
      mediaType,
      size: statSync(cleanedPath).size,
      data: readAttachmentAsBase64(cleanedPath),
    }
  } catch (error) {
    console.warn('[Chat 分享] 读取本地图片失败，已跳过:', cleanedPath, error)
    return null
  }
}

function extractLocalImageAttachments(content: string): ShareAttachment[] {
  if (!content) return []

  const attachments: ShareAttachment[] = []
  const seenPaths = new Set<string>()

  for (const blockMatch of content.matchAll(ATTACHED_FILES_BLOCK_PATTERN)) {
    const block = blockMatch[0]
    for (const line of block.split(/\r?\n/)) {
      const fileMatch = line.match(/^\s*-\s*([^:]+):\s*(.+?)\s*$/)
      if (!fileMatch?.[2]) continue

      const filePath = cleanExtractedPath(fileMatch[2])
      if (seenPaths.has(filePath)) continue
      seenPaths.add(filePath)

      const attachment = serializeLocalImageAttachment(filePath, fileMatch[1])
      if (attachment) attachments.push(attachment)
    }
  }

  for (const pathMatch of content.matchAll(IMAGE_PATH_PATTERN)) {
    const filePath = cleanExtractedPath(pathMatch[0])
    if (seenPaths.has(filePath)) continue
    seenPaths.add(filePath)

    const attachment = serializeLocalImageAttachment(filePath)
    if (attachment) attachments.push(attachment)
  }

  return attachments
}

function mediaTypeToExt(mediaType: string): string {
  const ext = mediaType.split('/')[1]?.toLowerCase() || 'jpg'
  return ext === 'jpeg' ? 'jpg' : ext
}

function extractBase64ImageAttachment(value: unknown, id: string): ShareAttachment | null {
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  const source = typeof record.source === 'object' && record.source !== null
    ? record.source as Record<string, unknown>
    : undefined

  const data = typeof source?.data === 'string'
    ? source.data
    : typeof record.data === 'string'
      ? record.data
      : undefined

  if (!data) return null

  const sourceType = typeof source?.type === 'string' ? source.type : undefined
  const mediaType = typeof source?.media_type === 'string'
    ? source.media_type
    : typeof source?.mediaType === 'string'
      ? source.mediaType
      : typeof record.media_type === 'string'
        ? record.media_type
        : typeof record.mediaType === 'string'
          ? record.mediaType
          : sourceType?.startsWith('image/')
            ? sourceType
            : typeof record.type === 'string' && record.type.startsWith('image/')
              ? record.type
              : 'image/jpeg'

  if (!mediaType.startsWith('image/')) return null

  const size = typeof source?.originalSize === 'number'
    ? source.originalSize
    : typeof record.originalSize === 'number'
      ? record.originalSize
      : Buffer.byteLength(data, 'base64')

  const filename = typeof record.filename === 'string'
    ? record.filename
    : `${id}.${mediaTypeToExt(mediaType)}`

  return {
    id,
    filename,
    mediaType,
    size,
    data,
  }
}

function extractSdkImageAttachments(blocks: SDKUserContentBlock[] | undefined, prefix: string): ShareAttachment[] {
  if (!blocks) return []

  const attachments: ShareAttachment[] = []
  blocks.forEach((block, blockIndex) => {
    const direct = extractBase64ImageAttachment(block, `${prefix}-image-${blockIndex}`)
    if (direct) attachments.push(direct)

    if (block.type !== 'tool_result') return
    const toolResult = block as SDKToolResultBlock
    const content = toolResult.content
    if (!Array.isArray(content)) return

    content.forEach((item, itemIndex) => {
      const attachment = extractBase64ImageAttachment(item, `${prefix}-tool-image-${blockIndex}-${itemIndex}`)
      if (attachment) attachments.push(attachment)
    })
  })

  return attachments
}

function mergeAttachments(...groups: Array<Array<ShareAttachment | null | undefined> | undefined>): ShareAttachment[] {
  const merged: ShareAttachment[] = []
  const seen = new Set<string>()

  for (const group of groups) {
    if (!group) continue
    for (const attachment of group) {
      if (!attachment) continue
      const key = `${attachment.filename}:${attachment.mediaType}:${attachment.size}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(attachment)
    }
  }

  return merged
}

function serializeAttachment(attachment: FileAttachment): ShareAttachment {
  const shared: ShareAttachment = {
    id: attachment.id,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    size: attachment.size,
  }

  if (attachment.mediaType.startsWith('image/')) {
    try {
      shared.data = readAttachmentAsBase64(attachment.localPath)
    } catch (error) {
      console.warn('[Chat 分享] 读取图片附件失败，已跳过数据:', attachment.localPath, error)
    }
  }

  return shared
}

function serializeMessage(message: ChatMessage, user: ShareUser): ShareMessage {
  const rawContent = message.content ?? ''
  const shared: ShareMessage = {
    id: message.id,
    role: message.role,
    content: stripAttachedFilesBlocks(rawContent),
    createdAt: message.createdAt,
    time: formatShareTime(message.createdAt),
  }

  if (message.model) shared.model = message.model
  if (message.reasoning) shared.reasoning = message.reasoning
  if (message.stopped) shared.stopped = message.stopped
  if (message.error) shared.error = message.error
  if (message.role === 'user') shared.user = user
  if (message.role === 'assistant') shared.modelAvatar = resolveModelAvatar(message.model)

  const attachments = mergeAttachments(
    message.attachments?.map(serializeAttachment),
    extractLocalImageAttachments(rawContent),
  )
  if (attachments.length > 0) {
    shared.attachments = attachments
  }

  return shared
}

function isTextBlock(block: unknown): block is SDKTextBlock {
  return typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text'
}

function textFromAssistantBlock(block: SDKContentBlock): string | null {
  if (isTextBlock(block)) return block.text

  if (block.type === 'thinking' && typeof block.thinking === 'string') {
    return block.thinking
  }

  if (block.type === 'tool_use') {
    return null
  }

  return null
}

function textFromUserBlock(block: SDKUserContentBlock): string | null {
  if (isTextBlock(block)) return block.text
  return null
}

function serializeSdkMessage(message: SDKMessage, index: number, user: ShareUser): ShareMessage | null {
  const metadata = message as unknown as { _createdAt?: unknown }
  const createdAt = typeof metadata._createdAt === 'number'
    ? metadata._createdAt
    : Date.now() + index

  if (message.type === 'user') {
    const userMessage = message as SDKUserMessage
    if (userMessage.isSynthetic) return null

    const rawContent = (userMessage.message?.content ?? [])
      .map(textFromUserBlock)
      .filter((text): text is string => Boolean(text && text.trim()))
      .join('\n\n')
      .trim()
    const content = stripAttachedFilesBlocks(rawContent)
    const attachments = mergeAttachments(
      extractLocalImageAttachments(rawContent),
      extractSdkImageAttachments(userMessage.message?.content, userMessage.uuid || `agent-user-${index}`),
    )

    if (!content && attachments.length === 0) return null

    const shared: ShareMessage = {
      id: userMessage.uuid || `agent-user-${index}`,
      role: 'user',
      content,
      createdAt,
      time: formatShareTime(createdAt),
      user,
    }
    if (attachments.length > 0) shared.attachments = attachments
    return shared
  }

  if (message.type === 'assistant') {
    const assistantMessage = message as SDKAssistantMessage
    const content = (assistantMessage.message?.content ?? [])
      .map(textFromAssistantBlock)
      .filter((text): text is string => Boolean(text && text.trim()))
      .join('\n\n')
      .trim()

    const errorMessage = assistantMessage.error?.message?.trim()
    const finalContent = content || errorMessage
    if (!finalContent) return null

    const model = assistantMessage._channelModelId || assistantMessage.message?.model
    return {
      id: assistantMessage.uuid || `agent-assistant-${index}`,
      role: 'assistant',
      content: finalContent,
      createdAt,
      time: formatShareTime(createdAt),
      model,
      modelAvatar: resolveModelAvatar(model),
      error: errorMessage && !content ? errorMessage : undefined,
    }
  }

  return null
}

export async function shareConversation(conversationId: string): Promise<ChatShareResult> {
  const conversation = listConversations().find((item) => item.id === conversationId)
  if (!conversation) {
    throw new Error(`对话不存在: ${conversationId}`)
  }

  const messages = getConversationMessages(conversationId)
  if (messages.length === 0) {
    throw new Error('当前对话没有可分享的消息')
  }

  const user = getShareUserProfile()
  const payload = {
    title: conversation.title || '无标题对话',
    exportedAt: new Date().toISOString(),
    source: 'proma',
    conversationId,
    user,
    messages: messages.map((message) => serializeMessage(message, user)),
  }

  const response = await fetch(SHARE_UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const responseText = await response.text()
  let result: { id?: string; url?: string; error?: string; detail?: string } = {}
  try {
    result = responseText ? JSON.parse(responseText) : {}
  } catch {
    if (!response.ok) {
      throw new Error(`分享服务返回异常 (${response.status})`)
    }
  }

  if (!response.ok || result.error || result.detail) {
    throw new Error(result.error || result.detail || `分享服务请求失败 (${response.status})`)
  }

  const id = result.id || (result.url ? new URL(result.url).searchParams.get('id') ?? undefined : undefined)
  if (!id) {
    throw new Error('分享服务未返回分享 ID')
  }

  return {
    id,
    url: buildPublicUrl(id),
  }
}

export async function shareAgentSession(sessionId: string): Promise<ChatShareResult> {
  const session = getAgentSessionMeta(sessionId)
  if (!session) {
    throw new Error(`Agent 会话不存在: ${sessionId}`)
  }

  const user = getShareUserProfile()
  const messages = getAgentSessionSDKMessages(sessionId)
    .map((message, index) => serializeSdkMessage(message, index, user))
    .filter((message): message is ShareMessage => Boolean(message))

  if (messages.length === 0) {
    throw new Error('当前 Agent 会话没有可分享的消息')
  }

  const payload = {
    title: session.title || '无标题 Agent 会话',
    exportedAt: new Date().toISOString(),
    source: 'proma-agent',
    sessionId,
    user,
    messages,
  }

  const response = await fetch(SHARE_UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const responseText = await response.text()
  let result: { id?: string; url?: string; error?: string; detail?: string } = {}
  try {
    result = responseText ? JSON.parse(responseText) : {}
  } catch {
    if (!response.ok) {
      throw new Error(`分享服务返回异常 (${response.status})`)
    }
  }

  if (!response.ok || result.error || result.detail) {
    throw new Error(result.error || result.detail || `分享服务请求失败 (${response.status})`)
  }

  const id = result.id || (result.url ? new URL(result.url).searchParams.get('id') ?? undefined : undefined)
  if (!id) {
    throw new Error('分享服务未返回分享 ID')
  }

  return {
    id,
    url: buildPublicUrl(id),
  }
}
