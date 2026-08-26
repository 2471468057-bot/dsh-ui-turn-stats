/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-turn-stats`.
 * @module @deepseek-ai/dsh-client-ui-turn-stats/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-turn-stats'

/** Cordis companion plugin name. */
export const name = 'client-ui-turn-stats-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin owns a single conversation-node definition
 * and one keyed chat-row renderer whose disposers are proven by the HMR-safety
 * spec; it owns no store, emits no cordis events, and holds only the
 * per-turn instantaneous-speed memo keyed by turn number.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
