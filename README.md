# @deepseek-ai/dsh-client-ui-turn-stats

English | [中文](README.zh.md)

Per-answer turn statistics row: wall time, context/output tokens, and the tokens-per-second rate, narrated out loud by a randomly picked cute kaomoji.

## Model experience

This is a presentation-only UI plugin. It never enters a model request and never changes the session log: every number (duration, `usage.inputTokens`/`usage.outputTokens`, decode timing) comes from engine-published turn data already in the conversation snapshot. What the model sees is identical with or without this plugin.

## Behavior

- While a turn streams, one live row appears after the answer text (following the text cursor) and refreshes every second:
  - **Duration**: wall time from `turn/start` to now.
  - **Output tokens**: authoritative usage from finalized steps plus a rough estimate of the current streaming text.
  - **Tokens per second**: the newly emitted tokens of the last second (instantaneous speed, not the full-run average).
- When the turn ends the row settles in place with the final duration, context/output tokens, and the last measured instantaneous rate. Replayed history turns get settled rows too.
- The speaker is picked deterministically per turn from a 32-entry kaomoji pool and animated with pure-CSS keyframes (bounce / wiggle / blink / groove); live and settled phases use separate spoken templates.

## Implementation

- Registers a custom conversation node `turn-stats` (`conversationEvents.register`) plus its `conversation.chat.node` renderer row.
- Reading the same engine data the shipped turn-tail uses (`TurnLocation.steps[].data.get('assistant-step')` → `finalNode.usage/timing`); no new RPC and no path-grammar change.
- Timing goes through the cordis `timer` service (`ctx.get('timer')`; falls back to a static non-ticking row when absent); the component never touches global timers.
- Registration surfaces: root `tsconfig.client.json` references, a `packages/bundle/web-app/cordis.patch.yml` row, and a `packages/bundle/web-app/package.json` dependency.

## Known Limitations and Deferred Work

- Streaming tokens are a text-length estimate (~4 chars/token) that jumps to the authoritative count when the step finalizes; this is expected.
- The instantaneous rate is a per-second sample, so sub-second bursts are smoothed; history turns without samples fall back to the decode-wide average rate.
- The plugin is presentation-only with no toggle; configurability (font size, TTFT display, on/off) can be added as `Config` fields in a later version.