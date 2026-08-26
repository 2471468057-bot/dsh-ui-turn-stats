/**
 * Per-answer turn statistics plugin, browser half. Registers one
 * live-following chat node ('turn-stats') that narrates each turn's wall
 * time, context/output tokens and tokens-per-second through an animated
 * kaomoji, plus the keyframes its pose animations need.
 */

import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { bindTurnStatsTimer, TurnStatsLine } from './TurnStatsLine.tsx'
import { createTurnStatsDefinition, type TurnStatsNodeData } from './turn-stats.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Per-turn stats line materialized by ui-turn-stats. */
    'turn-stats': TurnStatsNodeData
  }
}

/** Pure-CSS pose keyframes and their registration into one stylesheet. */
export const POSE_KEYFRAMES = [
  '@keyframes dshw-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }',
  '@keyframes dshw-wiggle { 0%,100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }',
  '@keyframes dshw-blink { 0%,88%,100% { opacity: 1; } 92% { opacity: 0.2; } }',
  '@keyframes dshw-groove { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }',
].join('')

/** Services required by the node definition registry and slot seat. */
export const inject = ['slots', 'conversationEvents']

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Timer mixin bound through ctx.get so the ticking row never reaches a
  // global timer; a missing timer service degrades to a static settled line.
  const timer = ctx.get('timer') as { interval?: (cb: () => void, delay: number) => () => void } | undefined
  bindTurnStatsTimer((callback, delay) => {
    if (timer?.interval === undefined) return () => {}
    return timer.interval(callback, delay)
  })
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = '@deepseek-ai/dsh-client-ui-turn-stats'
    style.textContent = POSE_KEYFRAMES
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-turn-stats: pose keyframes')
  ctx.effect(
    () => ctx.conversationEvents.register(createTurnStatsDefinition()),
    'ui-turn-stats: turn-stats node',
  )
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'turn-stats',
  }, TurnStatsLine))
}
