/**
 * The per-answer stats row: narrates wall time, context/output tokens and
 * the tokens-per-second speed through one animated kaomoji speaker. While the
 * turn streams the clock ticks every second and the speed is the measured
 * last-second delta; once closed the row settles on the frozen values.
 */

import { createElement, useEffect, useRef, useState, type ReactElement } from 'react'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  memeForTurn, patternFor, poseFor, spokenItems, type TurnStatsNodeData,
} from './turn-stats.ts'
import css from './TurnStatsLine.module.css'

export type { TurnStatsNodeData }

/**
 * Timer seam: apply() binds the cordis timer mixin's interval to this factory
 * so the component stays free of global timers and testable with a stub.
 * Defaults to a no-op disposer so a bare render never leaks a timer.
 */
let intervalFactory: (callback: () => void, delay: number) => () => void = () => () => {}

/** Bind the running interval factory (call once from apply). */
export function bindTurnStatsTimer(factory: (callback: () => void, delay: number) => () => void): void {
  intervalFactory = factory
}

/** The last measured instantaneous tok/s per turn, shared with the settled row. */
const lastTpsByTurn = new Map<number, number>()

/** One settled or streaming turn-stats chat-row node. */
export type TurnStatsLineProps = { node: ChatNode<'turn-stats'> }

export function TurnStatsLine({ node }: TurnStatsLineProps): ReactElement | null {
  const data = node.data
  const open = data.open
  const turn = data.turn
  const startTime = data.startTime
  const endTime = data.endTime
  const firstTokenTime = data.firstTokenTime
  const outputTokens = data.outputTokens
  const [now, setNow] = useState(() => Date.now())
  const outRef = useRef(outputTokens)
  outRef.current = outputTokens
  const sampleRef = useRef<{ time: number | null; tokens: number }>({ time: null, tokens: 0 })
  const [instTps, setInstTps] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (!open) return undefined
    outRef.current = outputTokens
    setNow(Date.now())
    return intervalFactory(() => {
      const nowMs = Date.now()
      setNow(nowMs)
      const previous = sampleRef.current
      if (previous.time !== null) {
        const seconds = (nowMs - previous.time) / 1000
        const delta = outRef.current - previous.tokens
        if (seconds > 0 && delta >= 0) {
          lastTpsByTurn.set(turn, delta / seconds)
          setInstTps(delta / seconds)
        }
      }
      sampleRef.current = { time: nowMs, tokens: outRef.current }
    }, 1000)
  }, [open])

  let elapsedMs: number | null
  let tokensPerSecond: number | undefined
  if (open) {
    elapsedMs = startTime === null ? null : Math.max(0, now - startTime)
    tokensPerSecond = instTps !== undefined
      ? instTps
      : firstTokenTime !== undefined && outputTokens > 0
        ? outputTokens / Math.max(0.001, (now - firstTokenTime) / 1000)
        : undefined
  } else {
    elapsedMs = startTime !== null && endTime !== null ? Math.max(0, endTime - startTime) : null
    tokensPerSecond = lastTpsByTurn.get(turn) ?? data.tokensPerSecond
  }

  const items = spokenItems(elapsedMs, data.inputTokens, data.outputTokens, tokensPerSecond)
  if (items.length === 0) return null
  const phrase = items.join('，')
  const speaker = memeForTurn(turn)
  const pose = poseFor(turn)
  const spoken = patternFor(turn, open)(phrase)
  return createElement(
    'div',
    { 'data-turn-stats': open ? 'live' : 'settled', className: css.root },
    [
      createElement('span', {
        key: 'face',
        className: css.face,
        style: { animation: `${pose.name} ${pose.duration} ease-in-out infinite` },
      }, speaker),
      ` ${spoken}`,
    ],
  )
}
