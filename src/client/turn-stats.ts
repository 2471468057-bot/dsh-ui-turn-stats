/**
 * Per-answer turn statistics: one live-following chat row that settles in
 * place. The definition mirrors the engine's turn boundaries (turn/start …
 * turn/end), derives wall time from the boundary events and token counts from
 * each finalized assistant step's usage/timing, and narrates the numbers
 * through a deterministic per-turn kaomoji speaker.
 *
 * @module @deepseek-ai/dsh-client-ui-turn-stats/turn-stats
 */

// Type-only: pulls the ui-conversation ConversationStepDataMap merge, so
// `step.data.get('assistant-step')` resolves to AssistantChatData.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  AssistantMessageNode, ChatConversationViewNode, ConversationNodeContext,
  ConversationNodeDefinition, ConversationPublication, TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'

/** One settled per-turn stats row payload. */
export interface TurnStatsNodeData {
  readonly turn: number
  readonly open: boolean
  readonly startTime: number | null
  readonly endTime: number | null
  readonly runMs: number | null
  /** Earliest streamed chunk time — the live decode origin. */
  readonly firstTokenTime?: number
  readonly inputTokens: number
  readonly outputTokens: number
  /** Log-derived average decode throughput; the live row prefers the frozen
   *  last-second instantaneous reading instead. */
  readonly tokensPerSecond?: number
  readonly meme: string
}

/** Definition-local Context state. */
export interface TurnStatsState {
  readonly turn: number
  readonly startTime: number | null
  readonly endTime: number | null
}

/** Derived token facts for one turn. */
export interface TurnStatsFacts {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly tokensPerSecond: number | undefined
}

/** Cute meme kaomoji speakers. */
export const KAOJI_POOL = [
  '(・∀・)', '(◕‿◕)', '(￣▽￣)', '(≧▽≦)', '(｡･ω･｡)', '(๑˃̵ᴗ˂̵)',
  '(◍•ᴗ•◍)', '(✿◡‿◡)', '٩(◕‿◕)۶', '(=´▽`)', '(^・ω・^)',
  '(´｡• ᵕ •｡`)', '(＞﹏＜)', '(o´ω`o)', '(ㆆᴗㆆ)', '(´｡•ω•｡`)',
  'ヽ(・∀・)ノ', '(｀・ω・´)', '(；´Д｀)', '(・_・;)', '(。・ω・。)',
  '(´▽`)', '(¬‿¬)', '( ͡° ͜ʖ ͡°)', '( •̀ ω •́ )', '(´･ω･`)',
  '(˶˃ ᵕ ˂˶)', '(｡•̀ᴗ-)✧', '(ᵔᴥᵔ)', '(◕‿◕✿)', '(≧◡≦)', '(❁´◡`❁)',
] as const

/** Spoken wrappers for the streaming phase. */
export const LIVE_PATTERNS = [
  (phrase: string) => `生成中～${phrase} 快了快了！`,
  (phrase: string) => `正在努力输出：${phrase} ！`,
  (phrase: string) => `奋笔疾书中，${phrase}……`,
] as const

/** Spoken wrappers for the settled phase. */
export const SETTLED_PATTERNS = [
  (phrase: string) => `搞定！${phrase}！`,
  (phrase: string) => `完成啦～${phrase} 哦。`,
  (phrase: string) => `这轮小报告：${phrase}`,
] as const

/** Pure-CSS keyframe poses applied to the speaking face. */
export const POSES = [
  { name: 'dshw-bounce', duration: '1.6s' },
  { name: 'dshw-wiggle', duration: '1.4s' },
  { name: 'dshw-blink', duration: '2.4s' },
  { name: 'dshw-groove', duration: '1.8s' },
] as const

/** Deterministic LCG-style picker over a closed pool (stable per turn). */
function pick(turn: number, salt: number, length: number): number {
  const value = (turn * 1103515245 + salt) | 0
  return (value < 0 ? -value : value) % length
}

/** One stable kaomoji speaker per turn. */
export function memeForTurn(turn: number): string {
  return KAOJI_POOL[pick(turn, 2654435761, KAOJI_POOL.length)] as string
}

/** One stable spoken wrapper per turn and phase. */
export function patternFor(turn: number, open: boolean): (phrase: string) => string {
  const patterns = open ? LIVE_PATTERNS : SETTLED_PATTERNS
  return patterns[pick(turn, open ? 7 : 13, patterns.length)] as (phrase: string) => string
}

/** One stable animated pose per turn. */
export function poseFor(turn: number): { readonly name: string; readonly duration: string } {
  return POSES[pick(turn, 31, POSES.length)] as { readonly name: string; readonly duration: string }
}

/** Format a time span; sub-second spans gain a second decimal. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 1000).toFixed(1)}s`
}

/** Format a token count with a k-abbreviation from ten thousand on. */
export function formatTokens(value: number): string {
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

/** Read non-negative input/output token counts from one usage record. */
function usageCounts(usage: unknown): { input: number; output: number } {
  if (typeof usage !== 'object' || usage === null) return { input: 0, output: 0 }
  const record = usage as { inputTokens?: unknown; outputTokens?: unknown }
  const input = typeof record.inputTokens === 'number' && record.inputTokens >= 0 ? record.inputTokens : 0
  const output = typeof record.outputTokens === 'number' && record.outputTokens >= 0 ? record.outputTokens : 0
  return { input, output }
}

/** Measure one step's decode time from its finalized timing, if present. */
function decodeMsOf(finalNode: AssistantMessageNode): number | null {
  const timing = finalNode.timing
  if (timing === undefined) return null
  const { firstTokenTime, completedTime } = timing
  if (firstTokenTime === null) return null
  return Math.max(0, completedTime - firstTokenTime)
}

/**
 * Fold one engine-owned turn's finalized assistant steps into token facts.
 * An assistant step still streaming contributes a rough text-length/4
 * estimate so the live readout works before the first step finalizes.
 * @param turn - the engine-owned TurnLocation to fold.
 * @returns summed input/output tokens and the decode-average throughput.
 */
export function foldTurn(turn: TurnLocation): TurnStatsFacts {
  let inputTokens = 0
  let outputTokens = 0
  let decodeMs = 0
  for (const step of turn.steps) {
    const assistant = step.data.get('assistant-step')
    if (assistant === undefined) continue
    const finalNode = assistant.finalNode
    if (finalNode !== undefined && finalNode.usage !== undefined) {
      const counts = usageCounts(finalNode.usage)
      inputTokens += counts.input
      outputTokens += counts.output
      const decode = decodeMsOf(finalNode)
      if (decode !== null && counts.output > 0) decodeMs += decode
    } else if (assistant.status !== 'settled') {
      // Streaming step: estimate emitted tokens from the text produced so far.
      let chars = 0
      for (const block of assistant.blocks) {
        if (block.kind === 'text') chars += block.text.length
      }
      if (chars > 0) outputTokens += Math.max(1, Math.round(chars / 4))
    }
  }
  const tokensPerSecond = decodeMs > 0 && outputTokens > 0 ? outputTokens / (decodeMs / 1000) : undefined
  return { inputTokens, outputTokens, tokensPerSecond }
}

/** Earliest streamed chunk time in the context — the live decode origin. */
function firstChunkTime(context: ConversationNodeContext<TurnStatsState>): number | undefined {
  let first: number | undefined
  for (const match of context.matches) {
    const event = match.event
    if (event.type === 'assistant/chunk') {
      if (first === undefined || event.time < first) first = event.time
    }
  }
  return first
}

/** Sortable anchor following the live text cursor (settled rows land just
 *  before the engine's turn-tail so the native action strip stays last). */
function anchorOf(context: ConversationNodeContext<TurnStatsState>, closed: boolean): number {
  let anchor = 0
  for (const match of context.matches) {
    const event = match.event
    const candidate = event.type === 'assistant/chunk'
      || event.type === 'assistant/message'
      || event.type === 'tool/call'
      || event.type === 'tool/result'
      || event.type === 'step/end'
      || event.type === 'llm/retry'
      || event.type === 'turn/end'
      ? event.seq
      : undefined
    if (candidate !== undefined && candidate > anchor) anchor = candidate
  }
  return closed ? anchor + 0.06 : anchor + 0.03
}

/** The engine Location of the context's accepted events. */
function locationOf(context: ConversationNodeContext<TurnStatsState>): ChatConversationViewNode['location'] {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

/** TurnLocation when the context resolves inside a turn. */
function locationTurn(context: ConversationNodeContext<TurnStatsState>): TurnLocation | undefined {
  const location = locationOf(context)
  return location.kind === 'turn' || location.kind === 'step' ? location.turn : undefined
}

/**
 * One live-following per-turn stats definition: materializes while the turn
 * streams (animation-frame cadence on each chunk), settles in place at
 * turn/end, and replays into closed history turns on reload.
 * @returns the Conversation node definition.
 */
export function createTurnStatsDefinition(): ConversationNodeDefinition<TurnStatsState> {
  return {
    kind: 'turn-stats',
    target: 'chat',
    match(event) {
      const accepted = (event.type === 'turn/start' || event.type === 'turn/end'
        || event.type === 'tool/call' || event.type === 'tool/result'
        || event.type === 'assistant/message' || event.type === 'assistant/chunk'
        || event.type === 'step/end' || event.type === 'llm/retry')
        && typeof event.data.turn === 'number'
      if (!accepted) return null
      const turn = event.data.turn
      return { id: String(turn), role: event.type === 'turn/start' ? 'start' : 'update' }
    },
    start(_context, match, _reader) {
      const turn = (match.event.data as { turn: number }).turn
      return {
        turn,
        startTime: typeof match.event.time === 'number' ? match.event.time : null,
        endTime: null,
      }
    },
    update(context, match) {
      if (match.event.type !== 'turn/end') return context.state
      return { ...context.state, endTime: typeof match.event.time === 'number' ? match.event.time : null }
    },
    publication(match): ConversationPublication {
      if (match.event.type === 'turn/end') return 'immediate'
      if (match.event.type === 'assistant/chunk' || match.event.type === 'tool/call' || match.event.type === 'tool/result') {
        return 'animation-frame'
      }
      return 'none'
    },
    buildViewNode(context): ChatConversationViewNode | null {
      const state = context.state
      if (state === undefined) return null
      const endTime = state.endTime
      const closed = endTime !== null
      const affected = locationTurn(context)
      const facts = affected === undefined
        ? { inputTokens: 0, outputTokens: 0, tokensPerSecond: undefined }
        : foldTurn(affected)
      const firstToken = firstChunkTime(context)
      const data: TurnStatsNodeData = {
        turn: state.turn,
        open: !closed,
        startTime: state.startTime,
        endTime,
        runMs: closed && state.startTime !== null ? Math.max(0, endTime - state.startTime) : null,
        inputTokens: facts.inputTokens,
        outputTokens: facts.outputTokens,
        meme: memeForTurn(state.turn),
        ...(firstToken !== undefined ? { firstTokenTime: firstToken } : {}),
        ...(closed && facts.tokensPerSecond !== undefined ? { tokensPerSecond: facts.tokensPerSecond } : {}),
      }
      if (closed && data.runMs === null && data.inputTokens === 0 && data.outputTokens === 0) return null
      return {
        key: context.key,
        kind: 'turn-stats',
        id: context.id,
        target: 'chat',
        anchorSeq: anchorOf(context, closed),
        location: locationOf(context),
        visibility: 'visible',
        data,
      }
    },
  }
}

/** Build the narrated items for one line; mirrors what the line renders. */
export function spokenItems(elapsedMs: number | null, inputTokens: number, outputTokens: number, tps: number | undefined): string[] {
  const items: string[] = []
  if (elapsedMs !== null && Number.isFinite(elapsedMs)) items.push(`花了 ${formatDuration(Math.max(0, elapsedMs))}`)
  if (inputTokens > 0) items.push(`上下文用了 ${formatTokens(inputTokens)}`)
  if (outputTokens > 0) items.push(`输出了 ${formatTokens(outputTokens)}`)
  if (tps !== undefined && Number.isFinite(tps)) items.push(`每秒 ${tps.toFixed(1)} token`)
  return items
}
