// Bundled bilingual guide for suite:trend/nine. Lazily imported by GuidePanel.

export const en = `# Nine-Bar Exhaustion

A transparent close-versus-four-bars-back count that identifies sustained directional pressure. A completed 9 can mark possible exhaustion, but it is not a reversal prediction and never becomes a Buy/Sell instruction by itself.

## What you see

A **rising sequence** advances when each close is above the close four chart bars earlier. Its numbers sit above candles because the potential risk is upside exhaustion. A **falling sequence** advances when each close is below the close four chart bars earlier; its numbers sit below candles because the possible response is a downside-exhaustion bounce.

The default **Reveal at 6** view follows common Magic Nine chart behavior: counts 1–5 stay hidden until the sixth qualifying bar, then 1–6 appear together. If the run breaks before completion, those unfinished annotations disappear. A finalized 1–9 pattern remains in history.

A pill and diamond distinguish a finalized 9. A still-open candle may show a forming 9, but it receives no confirmed marker and cannot fire an alert. Every label explains the exact close comparison and says explicitly that exhaustion does not guarantee reversal.

The calculation is bar-based. On a sparse one-minute feed, “four bars back” means the fourth earlier chart bar, not a fabricated trade exactly four wall-clock minutes earlier.

## How to use it

Use the count as **context**, then demand independent evidence. A falling 9 near established support, after momentum divergence or a VWAP reclaim, is more informative than a falling 9 in the middle of an accelerating downtrend. A rising 9 can be an exit/tightening cue in an extended move, yet strong leaders often continue after 9.

Separate four states: count forming, count completed, independent reversal evidence present or absent, and historical evidence for that market/regime. Do not collapse them into one probability. When trend strength remains high and breadth/volume confirm the move, treat the 9 as a warning to manage risk rather than an automatic fade.

## Settings

**Display** — Reveal at 6 (default), Progressive 1–9, or Completed patterns only.

**Annotation Density** — all eligible counts, late counts 6–9, or completed 9 only. This changes drawing only, never calculation or alerts.

**Require Price Flip (off)** — optional DeMARK-like start prerequisite. Count 1 must follow the opposite four-bar relation. This still does not turn the study into full DeMARK Sequential.

**Sustained Trend** — One completion per uninterrupted run (default), or Repeat every 9 qualifying bars. Repeat mode completes at streaks 9, 18, 27… rather than firing on every later bar.

**Completion Markers (on)** — diamonds on finalized 9s. **Recent History** and **Label Size** control clutter without changing event identity.

## Signals & alerts

The module emits **nine_rising** when a rising sequence finalizes at 9 and **nine_falling** when a falling sequence finalizes at 9. Both use the completion bar as the confirmation bar and inherit Alert Center’s creation floor, freshness window, one-shot watermark, entitlement, delivery, and duplicate-suppression rules.

On-chart intraday counts work wherever the chart has adequate chronological bars. The current alert sidecar’s broad scanner uses finalized daily source files; adding this study does not prove all-symbol real-time intraday scanning or predictive edge.
`;

export const zh = `# 九转衰竭（Nine-Bar Exhaustion）

这是一个透明的“当前收盘价对比前四根图表K线收盘价”计数，用来识别持续的单向压力。完成的 9 可能意味着行情衰竭，但它不是反转预测，更不会单独变成买卖指令。

## 图上看到什么

**上涨序列**：当前收盘价高于前四根图表K线的收盘价时，计数前进一步。数字显示在K线上方，因为需要警惕的是上涨衰竭。**下跌序列**：当前收盘价低于前四根图表K线时，数字显示在K线下方，因为可能出现的是下跌衰竭后的反弹。

默认的**第6根揭示**模式贴近常见神奇九转图表行为：1–5 先隐藏，第6根继续满足条件时一次显示 1–6。若未完成的序列中断，这些临时标注会消失；已经最终确认的 1–9 结构会保留在历史中。

完成的 9 使用胶囊数字和菱形标记。尚未收盘的K线可以显示“形成中的 9”，但不会得到确认标记，也不能触发提醒。每个数字的检查框都会显示实际比较值，并明确写出“可能衰竭，并不保证反转”。

计算按图表K线进行。若一分钟数据存在缺口，“前四根”指图上第四根更早的K线，不会虚构恰好四分钟前的成交。

## 怎么用它

把计数当成**环境证据**，再寻找独立确认。下跌 9 若出现在明确支撑附近，并伴随动量背离或重新站上 VWAP，通常比加速下跌途中间位置的下跌 9 更有意义。上涨 9 可以用于延伸行情中的减仓或收紧止损，但强势龙头在 9 之后仍可能继续上涨。

请分开四种状态：计数形成中、计数已完成、是否存在独立反转证据，以及该市场/环境的历史验证结果。不要把它们压成一个未经验证的概率。若趋势强度仍高且广度、成交量继续确认，应把 9 当成风险管理警示，而不是自动逆势交易。

## 设置项

**Display 显示**——第6根揭示（默认）、逐步显示 1–9、或只显示已完成结构。

**Annotation Density 标注密度**——所有合格数字、只显示 6–9、或只显示完成的 9。它只改变画面，不改变计算与提醒。

**Require Price Flip 要求价格翻转（关）**——可选的 DeMARK 式起始条件：计数 1 之前必须出现相反的四根比较关系。即使开启，本指标也不是完整 DeMARK Sequential。

**Sustained Trend 持续趋势**——每段不中断行情只完成一次（默认），或每9根合格K线重复一次。重复模式在第 9、18、27… 根完成，而不是之后每根都触发。

**Completion Markers 完成标记（开）**——只给最终确认的 9 画菱形。**Recent History 最近历史**与**Label Size 字号**只控制拥挤度，不改变事件身份。

## 信号与提醒

上涨序列最终完成 9 时产生 **nine_rising**；下跌序列最终完成 9 时产生 **nine_falling**。两者都以完成K线作为确认K线，并沿用提醒中心现有的创建时间门槛、新鲜度窗口、一次性水位、权限、投递和去重规则。

只要图表具备足够且按时间排列的数据，盘中周期也能在图上计算。当前提醒侧车的大范围扫描使用已确认的日线源文件；加入本指标并不代表已经具备全市场实时盘中扫描，也不代表已经验证预测优势。
`;
