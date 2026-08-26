# @deepseek-ai/dsh-client-ui-turn-stats

[English](README.md) | 中文

每条回答下方的回合统计行：墙钟耗时、上下文/输出 token 与每秒 token 速率，由一只随机可爱的颜文字"开口播报"。

## Model experience

本插件是纯展示 UI，不进入模型请求，也不改变会话日志：所有数据（耗时、`usage.inputTokens`/`usage.outputTokens`、解码时序）都来自引擎已发布到会话快照的回合数据。模型看到的界面与没有本插件时完全一致。

## Behavior

- 回合生成中：在回答文本之后出现一行实时统计（跟随文本游标），每秒刷新：
  - **耗时**：`turn/start` → 当前时间的墙钟时长
  - **输出 token**：已完成步骤的权威 usage + 当前流式文本的估算值
  - **每秒 token**：最近一秒的新增 token（瞬时速度，非全程平均）
- 回合结束：该行原地定格，保留最终耗时、上下文/输出 token，以及最后一次实测的瞬时速率；历史回合同样在重放时生成定格行。
- 颜文字从 32 个候选池按轮次确定性抽取，附带纯 CSS 动画（弹跳/摇摆/眨眼/晃动）；同一轮播放"生成中 → 完成"两组口吻模板。

## Implementation

- 注册一个自定义会话节点 `turn-stats`（`conversationEvents.register`）与对应的 `conversation.chat.node` 渲染行。
- 数据读取与内置 `turn-tail` 同源（`TurnLocation.steps[].data.get('assistant-step')` 的 `finalNode.usage/timing`），不新增 RPC、不改路径文法。
- 计时通过 cordis `timer` 服务（`ctx.get('timer')`，缺失时退化为无跳动静态行），组件不触碰全局定时器。
- 注册面：根 `tsconfig.client.json` references、`packages/bundle/web-app/cordis.patch.yml` 行、`packages/bundle/web-app/package.json` 依赖。

## Known Limitations and Deferred Work

- 流式 token 为文本长度估算（约 4 字符/ token），步骤结束时跳变为权威值，是已知行为。
- 瞬时速率依赖每秒采样，1 秒内的突发速率会被平滑；无采样样本的历史回合回退到解码全程平均速率。
- 插件为纯展示，不提供开关；如需可配置（字号、是否显示 TTFT、开启/关闭），可在后续版本加 `Config` 字段。