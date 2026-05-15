/**
 * Chat 自动保存服务
 *
 * 将本地聊天记录按 用户 + 设备 + 会话 维度同步到分享后端。
 * 手动分享仍然走 /api/upload；自动保存走 /api/auto-save/chat 并覆盖同一会话。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { buildAgentSessionSharePayload, buildConversationSharePayload } from './chat-share-service'
import { getConfigDir } from './config-paths'
import { getUserProfile } from './user-profile-service'

const DEFAULT_AUTO_SAVE_URL = 'https://open.wxqsai.com/api/auto-save/chat'
const AUTO_SAVE_URL = process.env.PROMA_CHAT_AUTO_SAVE_URL || DEFAULT_AUTO_SAVE_URL
const AUTO_SAVE_DELAY_MS = 3500

interface AutoSaveDeviceIdentity {
  deviceId: string
  deviceName: string
  createdAt: string
}

const pendingSyncs = new Map<string, ReturnType<typeof setTimeout>>()

function isAutoSaveEnabled(): boolean {
  return process.env.PROMA_DISABLE_CHAT_AUTO_SAVE !== '1'
}

function getDeviceIdentityPath(): string {
  return join(getConfigDir(), 'auto-save-device.json')
}

function getDeviceIdentity(): AutoSaveDeviceIdentity {
  const filePath = getDeviceIdentityPath()

  if (existsSync(filePath)) {
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<AutoSaveDeviceIdentity>
      if (data.deviceId && data.deviceName && data.createdAt) {
        return {
          deviceId: data.deviceId,
          deviceName: data.deviceName,
          createdAt: data.createdAt,
        }
      }
    } catch (error) {
      console.warn('[聊天自动保存] 读取设备标识失败，将重新生成:', error)
    }
  }

  const identity: AutoSaveDeviceIdentity = {
    deviceId: randomUUID(),
    deviceName: hostname() || 'unknown-device',
    createdAt: new Date().toISOString(),
  }

  try {
    writeFileSync(filePath, JSON.stringify(identity, null, 2), 'utf-8')
  } catch (error) {
    console.warn('[聊天自动保存] 写入设备标识失败:', error)
  }

  return identity
}

function getUserId(userName: string): string {
  return createHash('sha256')
    .update(userName || '用户')
    .digest('hex')
    .slice(0, 24)
}

async function requestAutoSave(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, init)
  if (response.ok) return

  const text = await response.text().catch(() => '')
  throw new Error(text || `自动保存请求失败 (${response.status})`)
}

export async function autoSaveConversation(conversationId: string): Promise<void> {
  if (!isAutoSaveEnabled()) return

  let payload: ReturnType<typeof buildConversationSharePayload>
  try {
    payload = buildConversationSharePayload(conversationId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('没有可分享的消息') || message.includes('对话不存在')) return
    throw error
  }

  const profile = getUserProfile()
  const device = getDeviceIdentity()
  const body = {
    ...payload,
    sync: {
      userId: getUserId(profile.userName),
      userName: profile.userName,
      userAvatar: payload.user.avatar,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      syncedAt: new Date().toISOString(),
    },
  }

  await requestAutoSave(AUTO_SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function autoSaveAgentSession(sessionId: string): Promise<void> {
  if (!isAutoSaveEnabled()) return

  let payload: ReturnType<typeof buildAgentSessionSharePayload>
  try {
    payload = buildAgentSessionSharePayload(sessionId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('没有可分享的消息') || message.includes('会话不存在')) return
    throw error
  }

  const profile = getUserProfile()
  const device = getDeviceIdentity()
  const body = {
    ...payload,
    conversationId: sessionId,
    sync: {
      userId: getUserId(profile.userName),
      userName: profile.userName,
      userAvatar: payload.user.avatar,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      syncedAt: new Date().toISOString(),
    },
  }

  await requestAutoSave(AUTO_SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function scheduleAutoSaveConversation(conversationId: string, delayMs = AUTO_SAVE_DELAY_MS): void {
  if (!isAutoSaveEnabled()) return

  const existing = pendingSyncs.get(conversationId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    pendingSyncs.delete(conversationId)
    autoSaveConversation(conversationId).catch((error) => {
      console.warn('[聊天自动保存] 同步失败:', error)
    })
  }, delayMs)

  pendingSyncs.set(conversationId, timer)
}

export function scheduleAutoSaveAgentSession(sessionId: string, delayMs = AUTO_SAVE_DELAY_MS): void {
  if (!isAutoSaveEnabled()) return

  const key = `agent:${sessionId}`
  const existing = pendingSyncs.get(key)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    pendingSyncs.delete(key)
    autoSaveAgentSession(sessionId).catch((error) => {
      console.warn('[Agent 自动保存] 同步失败:', error)
    })
  }, delayMs)

  pendingSyncs.set(key, timer)
}

export async function deleteAutoSavedConversation(conversationId: string): Promise<void> {
  if (!isAutoSaveEnabled()) return

  const pending = pendingSyncs.get(conversationId)
  if (pending) {
    clearTimeout(pending)
    pendingSyncs.delete(conversationId)
  }

  const profile = getUserProfile()
  const device = getDeviceIdentity()
  const url = new URL(AUTO_SAVE_URL)
  url.searchParams.set('userId', getUserId(profile.userName))
  url.searchParams.set('deviceId', device.deviceId)
  url.searchParams.set('conversationId', conversationId)

  await requestAutoSave(url.toString(), { method: 'DELETE' })
}

export async function deleteAutoSavedAgentSession(sessionId: string): Promise<void> {
  if (!isAutoSaveEnabled()) return

  const key = `agent:${sessionId}`
  const pending = pendingSyncs.get(key)
  if (pending) {
    clearTimeout(pending)
    pendingSyncs.delete(key)
  }

  const profile = getUserProfile()
  const device = getDeviceIdentity()
  const url = new URL(AUTO_SAVE_URL)
  url.searchParams.set('userId', getUserId(profile.userName))
  url.searchParams.set('deviceId', device.deviceId)
  url.searchParams.set('conversationId', sessionId)

  await requestAutoSave(url.toString(), { method: 'DELETE' })
}
