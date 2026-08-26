/**
 * Live-following turn stats definition: matching, settling, and the pure
 * derivation helpers (deterministic speaker + narrated items).
 */

import { describe, expect, it } from 'vitest'
import type { ConversationNodeContext, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import {
  createTurnStatsDefinition, memeForTurn, patternFor, poseFor, spokenItems, type TurnStatsState,
} from '../src/client/turn-stats.ts'

const definition = createTurnStatsDefinition()

/** The definition's accepted SessionEvent type, without importing the session package. */
type AnyEvent = Parameters<ConversationNodeDefinition<TurnStatsState>['match']>[0]

/** Minimal accepted-event shape the definition reads. */
function event(type: string, turn: number, time = 1_000): AnyEvent {
  return { type, seq: 0, time, data: { turn } } as AnyEvent
}

/** Context shell for buildViewNode. */
function contextOf(
  state: TurnStatsState,
  matches: unknown[] = [],
): ConversationNodeContext<TurnStatsState> & { readonly state: TurnStatsState } {
  return {
    key: 'k', kind: 'turn-stats', id: 'id',
    matches: matches as never, start: undefined, state, current: new Map(),
  }
}

describe('turn-stats definition matching', () => {
  it('admits the turn lifecycle and assistant/tool events, rejects others', () => {
    expect(definition.match(event('turn/start', 3))).toEqual({ id: '3', role: 'start' })
    expect(definition.match(event('assistant/chunk', 3))).toEqual({ id: '3', role: 'update' })
    expect(definition.match(event('turn/end', 3))).toEqual({ id: '3', role: 'update' })
    expect(definition.match(event('user/message', 3))).toBeNull()
    expect(definition.match(event('turn/start', 'x' as never))).toBeNull()
  })

  it('settles the endTime on turn/end and keeps it otherwise', () => {
    const started = { turn: 3, startTime: 1_000, endTime: null }
    const updated = definition.update(contextOf(started), { event: event('tool/result', 3, 1_200) } as never)
    expect(updated.endTime).toBeNull()
    const ended = definition.update(contextOf(started), { event: event('turn/end', 3, 4_500) } as never)
    expect(ended.endTime).toBe(4_500)
  })

  it('declines to build a settled node with nothing measurable', () => {
    const node = definition.buildViewNode!(contextOf({ turn: 1, startTime: null, endTime: 5 }))
    expect(node).toBeNull()
  })

  it('builds an always-visible row for open turns and settled measurable turns', () => {
    const open = definition.buildViewNode!(contextOf({ turn: 1, startTime: 0, endTime: null }))
    expect(open).not.toBeNull()
    const openNode = open as { visibility: string; data: { open: boolean } } | null
    expect(openNode!.visibility).toBe('visible')
    expect(openNode!.data.open).toBe(true)
  })
})

describe('deterministic per-turn narration', () => {
  it('picks the same speaker and pose for one turn, both inside the pools', () => {
    expect(memeForTurn(4)).toBe(memeForTurn(4))
    expect(poseFor(4).name).toBe(poseFor(4).name)
    expect(memeForTurn(4)).toMatch(/^\(/)
  })

  it('wraps the phrase with a stable talking template per turn and phase', () => {
    const live = patternFor(2, true)('花了 1.2s')
    const settled = patternFor(2, false)('花了 1.2s')
    expect(live).not.toBe(settled)
    expect(settled).toContain('1.2s')
  })

  it('builds the narrated items with formatted numbers', () => {
    const items = spokenItems(1_500, 2_400, 1_800, 34.25)
    expect(items).toEqual(['花了 1.5s', '上下文用了 2400', '输出了 1800', '每秒 34.3 token'])
    expect(spokenItems(null, 0, 0, undefined)).toEqual([])
  })
})

describe('foldTurn token folding', () => {
  it('sums finalized usage and decode time into an average throughput', async () => {
    const { foldTurn } = await import('../src/client/turn-stats.ts')
    const assistant = (step: number): unknown => ({
      kind: 'assistant-step',
      turn: 1, step,
      status: 'settled',
      blocks: [],
      time: 1_000,
      usage: { inputTokens: 100, outputTokens: 200 },
      finalNode: {
        kind: 'assistant', seq: step, time: 1_000, turn: 1, step,
        blocks: [], usage: { inputTokens: 100, outputTokens: 200 },
        timing: { stepStartTime: 1_500, firstTokenTime: 2_000, completedTime: 3_000 },
      },
    })
    const turn = {
      turn: 1,
      start: { type: 'turn/start', seq: 1, time: 1_000, data: { turn: 1 } },
      end: { type: 'turn/end', seq: 20, time: 5_000, data: { turn: 1 } },
      status: 'closed' as const,
      steps: [
        { data: { get: () => assistant(1) } },
        { data: { get: () => assistant(2) } },
      ] as never,
      data: { get: () => undefined },
    } as never
    const facts = foldTurn(turn)
    expect(facts.inputTokens).toBe(200)
    expect(facts.outputTokens).toBe(400)
    // 400 output tokens over 2000ms of decode time => 200 tok/s.
    expect(facts.tokensPerSecond).toBeCloseTo(200, 0)
  })
})
