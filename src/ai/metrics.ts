import type { AgentMetrics } from "./types";

/**
 * Collects and tracks metrics during agent execution.
 *
 * This class provides a clean way to accumulate metrics data
 * throughout the agent execution lifecycle, including:
 * - Total execution duration
 * - Number of LLM calls
 * - Number of tool calls
 * - Duration per tool
 *
 * @example
 * ```typescript
 * const metrics = new AgentMetricsCollector();
 *
 * // Record an LLM call
 * metrics.recordLLMCall();
 *
 * // Record a tool call with duration
 * const startTime = Date.now();
 * await executeTool();
 * metrics.recordToolCall("search", Date.now() - startTime);
 *
 * // Get final metrics
 * const finalMetrics = metrics.getMetrics();
 * // { totalDurationMs: 1500, llmCalls: 2, toolCalls: 1, toolDurations: { search: 500 } }
 * ```
 */
export class AgentMetricsCollector {
  private startTime: number;
  private llmCalls = 0;
  private toolCalls = 0;
  private toolDurations: Record<string, number> = {};

  /**
   * Create a new metrics collector.
   *
   * @param startTime - Optional start time in milliseconds. Defaults to Date.now().
   */
  constructor(startTime?: number) {
    this.startTime = startTime ?? Date.now();
  }

  /**
   * Record an LLM call.
   */
  recordLLMCall(): void {
    this.llmCalls++;
  }

  /**
   * Record a tool call with its duration.
   *
   * @param toolName - Name of the tool that was called
   * @param durationMs - Duration of the tool call in milliseconds
   */
  recordToolCall(toolName: string, durationMs: number): void {
    this.toolCalls++;
    this.toolDurations[toolName] =
      (this.toolDurations[toolName] || 0) + durationMs;
  }

  /**
   * Get the current number of LLM calls.
   */
  getLLMCallCount(): number {
    return this.llmCalls;
  }

  /**
   * Get the current number of tool calls.
   */
  getToolCallCount(): number {
    return this.toolCalls;
  }

  /**
   * Get the total duration for a specific tool.
   *
   * @param toolName - Name of the tool
   * @returns Total duration in milliseconds, or 0 if tool wasn't called
   */
  getToolDuration(toolName: string): number {
    return this.toolDurations[toolName] || 0;
  }

  /**
   * Get the elapsed time since the collector was created.
   *
   * @returns Elapsed time in milliseconds
   */
  getElapsedTime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get the complete metrics object.
   *
   * @returns AgentMetrics object with all collected data
   */
  getMetrics(): AgentMetrics {
    return {
      totalDurationMs: this.getElapsedTime(),
      llmCalls: this.llmCalls,
      toolCalls: this.toolCalls,
      toolDurations: { ...this.toolDurations },
    };
  }

  /**
   * Reset all metrics to initial state.
   *
   * @param newStartTime - Optional new start time. Defaults to Date.now().
   */
  reset(newStartTime?: number): void {
    this.startTime = newStartTime ?? Date.now();
    this.llmCalls = 0;
    this.toolCalls = 0;
    this.toolDurations = {};
  }
}

/**
 * Create a simple metrics summary string for logging.
 *
 * @param metrics - The metrics object to summarize
 * @returns Human-readable summary string
 *
 * @example
 * ```typescript
 * const summary = formatMetricsSummary(metrics);
 * // "Duration: 1.5s | LLM calls: 2 | Tool calls: 3 (search: 500ms, fetch: 800ms)"
 * ```
 */
export function formatMetricsSummary(metrics: AgentMetrics): string {
  const durationSec = (metrics.totalDurationMs / 1000).toFixed(2);

  let summary = `Duration: ${durationSec}s | LLM calls: ${metrics.llmCalls} | Tool calls: ${metrics.toolCalls}`;

  const toolEntries = Object.entries(metrics.toolDurations);
  if (toolEntries.length > 0) {
    const toolSummary = toolEntries
      .map(([name, duration]) => `${name}: ${duration}ms`)
      .join(", ");
    summary += ` (${toolSummary})`;
  }

  return summary;
}

/**
 * Calculate average metrics across multiple agent runs.
 *
 * @param metricsArray - Array of metrics from multiple runs
 * @returns Averaged metrics object
 */
export function calculateAverageMetrics(
  metricsArray: AgentMetrics[],
): AgentMetrics {
  if (metricsArray.length === 0) {
    return {
      totalDurationMs: 0,
      llmCalls: 0,
      toolCalls: 0,
      toolDurations: {},
    };
  }

  const count = metricsArray.length;

  // Sum all metrics
  const totals = metricsArray.reduce(
    (acc, metrics) => {
      acc.totalDurationMs += metrics.totalDurationMs;
      acc.llmCalls += metrics.llmCalls;
      acc.toolCalls += metrics.toolCalls;

      for (const [tool, duration] of Object.entries(metrics.toolDurations)) {
        acc.toolDurations[tool] = (acc.toolDurations[tool] || 0) + duration;
      }

      return acc;
    },
    {
      totalDurationMs: 0,
      llmCalls: 0,
      toolCalls: 0,
      toolDurations: {} as Record<string, number>,
    },
  );

  // Calculate averages
  return {
    totalDurationMs: Math.round(totals.totalDurationMs / count),
    llmCalls: Math.round(totals.llmCalls / count),
    toolCalls: Math.round(totals.toolCalls / count),
    toolDurations: Object.fromEntries(
      Object.entries(totals.toolDurations).map(([tool, duration]) => [
        tool,
        Math.round(duration / count),
      ]),
    ),
  };
}
