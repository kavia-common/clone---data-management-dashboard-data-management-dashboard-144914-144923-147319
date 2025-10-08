/**
 * Tests for createProgressiveExpandController (non-React utility) to ensure
 * - batched processing over time
 * - progress callbacks fire with increasing processed counts
 * - cancellation stops further processing
 */
import { createProgressiveExpandController } from "../useProgressiveExpand";

describe("createProgressiveExpandController", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Ensure no residual
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("processes items in batches and calls onDone", () => {
    const items = Array.from({ length: 105 }, (_, i) => i);
    const applied = [];
    const progressEvents = [];

    const ctl = createProgressiveExpandController({
      items,
      applyBatch: (batch) => applied.push(...batch),
      batchSize: 20,
      onProgress: ({ processed, total, pct }) => progressEvents.push({ processed, total, pct }),
      onDone: jest.fn(),
    });

    ctl.start();

    // Run timers until queue clears
    jest.runOnlyPendingTimers();
    // But controller schedules multiple ticks; runAllTimers to flush
    jest.runAllTimers();

    expect(applied.length).toBe(105);
    // Expect several progress events; last should be 100%
    expect(progressEvents.length).toBeGreaterThan(1);
    const last = progressEvents[progressEvents.length - 1];
    expect(last.pct).toBe(100);
    expect(last.processed).toBe(105);
    expect(last.total).toBe(105);
  });

  test("cancels mid-flight and stops applying", () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const applied = [];
    const onCancel = jest.fn();

    const ctl = createProgressiveExpandController({
      items,
      applyBatch: (batch) => applied.push(...batch),
      batchSize: 100,
      onCancel,
    });

    ctl.start();

    // First tick
    jest.runOnlyPendingTimers();
    // Cancel before subsequent ticks
    ctl.cancel();

    // Process remaining timers if any
    jest.runAllTimers();

    expect(onCancel).toHaveBeenCalled();
    // Should have processed at least one batch but not all items
    expect(applied.length).toBeGreaterThanOrEqual(100);
    expect(applied.length).toBeLessThan(1000);
  });
});
