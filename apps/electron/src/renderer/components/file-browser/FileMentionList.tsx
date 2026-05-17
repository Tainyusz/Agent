/**
 * FileMentionList — @ 引用文件下拉列表
 *
 * 显示文件搜索结果，支持键盘导航（上/下/Enter/Escape）。
 * 通过 React.useImperativeHandle 暴露 onKeyDown 给 TipTap Suggestion。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import type { FileIndexEntry } from '@proma/shared'
import { FileTypeIcon } from './FileTypeIcon'

export interface FileMentionListProps {
  items?: FileIndexEntry[]
  selectedIndex?: number
  sessionEntries?: FileIndexEntry[]
  workspaceEntries?: FileIndexEntry[]
  onSelect: (item: FileIndexEntry) => void
}

export interface FileMentionRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const FileMentionList = React.forwardRef<FileMentionRef, FileMentionListProps>(
  function FileMentionList({ items, selectedIndex = 0, sessionEntries, workspaceEntries, onSelect }, ref) {
    const groups = React.useMemo(() => {
      if (sessionEntries || workspaceEntries) {
        return [
          { key: 'session', label: '会话文件', entries: sessionEntries ?? [] },
          { key: 'workspace', label: '工作区文件', entries: workspaceEntries ?? [] },
        ].filter((group) => group.entries.length > 0)
      }

      const safeItems = items ?? []
      const session = safeItems.filter((item) => item.source === 'session')
      const workspace = safeItems.filter((item) => item.source === 'workspace')
      if (session.length > 0 || workspace.length > 0) {
        return [
          { key: 'session', label: '会话文件', entries: session },
          { key: 'workspace', label: '工作区文件', entries: workspace },
        ].filter((group) => group.entries.length > 0)
      }

      return [{ key: 'all', label: '', entries: safeItems }]
    }, [items, sessionEntries, workspaceEntries])

    const flatItems = React.useMemo(
      () => groups.flatMap((group) => group.entries),
      [groups],
    )
    const [localIndex, setLocalIndex] = React.useState(selectedIndex)
    const containerRef = React.useRef<HTMLDivElement>(null)

    // items 变化时重置选中索引
    React.useEffect(() => {
      setLocalIndex(Math.min(Math.max(selectedIndex, 0), Math.max(flatItems.length - 1, 0)))
    }, [flatItems, selectedIndex])

    // 滚动选中项到可见区域
    React.useEffect(() => {
      const container = containerRef.current
      if (!container) return
      const item = container.querySelector(`[data-mention-index="${localIndex}"]`) as HTMLElement | null
      item?.scrollIntoView({ block: 'nearest' })
    }, [localIndex])

    // 暴露键盘处理给 TipTap
    React.useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          if (flatItems.length === 0) return false
          setLocalIndex((prev) => (prev <= 0 ? flatItems.length - 1 : prev - 1))
          return true
        }
        if (event.key === 'ArrowDown') {
          if (flatItems.length === 0) return false
          setLocalIndex((prev) => (prev >= flatItems.length - 1 ? 0 : prev + 1))
          return true
        }
        if (event.key === 'Enter') {
          if (flatItems.length === 0) return false
          const item = flatItems[localIndex]
          if (item) onSelect(item)
          return true
        }
        if (event.key === 'Escape') {
          return true
        }
        return false
      },
    }))

    // 无匹配结果
    if (flatItems.length === 0) {
      return (
        <div className="rounded-lg border bg-popover p-2 shadow-lg text-[11px] text-muted-foreground">
          无匹配文件
        </div>
      )
    }

    return (
      <div
        ref={containerRef}
        className="rounded-lg border bg-popover shadow-lg overflow-y-auto max-h-[280px] min-w-[200px]"
      >
        {groups.map((group) => {
          let groupStartIndex = 0
          for (const previous of groups) {
            if (previous.key === group.key) break
            groupStartIndex += previous.entries.length
          }

          return (
            <div key={group.key}>
              {group.label && groups.length > 1 && (
                <div className="px-2.5 py-1 text-[10px] font-medium text-muted-foreground/70">
                  {group.label}
                </div>
              )}
              {group.entries.map((item, index) => {
                const flatIndex = groupStartIndex + index
                return (
                  <button
                    key={`${item.source}:${item.path}`}
                    type="button"
                    data-mention-index={flatIndex}
                    className={cn(
                      'w-full flex items-center gap-1.5 px-2.5 py-1 text-left text-xs hover:bg-accent transition-colors',
                      flatIndex === localIndex && 'bg-accent text-accent-foreground',
                    )}
                    onClick={() => onSelect(item)}
                  >
                    <FileTypeIcon name={item.name} isDirectory={item.type === 'dir'} size={12} />
                    <span className="truncate flex-1">{item.name}</span>
                    {/* 显示相对路径（当路径不等于文件名时） */}
                    {item.path !== item.name && (
                      <span className="text-[10px] text-muted-foreground/60 truncate max-w-[120px]">
                        {item.path}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    )
  },
)
