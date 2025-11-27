import { useCallback, useEffect, useRef, useState } from "react";

/**
 * PUBLIC_INTERFACE
 * createProgressiveExpandController
 * A non-React utility that progressively applies work (e.g., expanding tree nodes) in batches,
 * yielding to the main thread using requestIdleCallback or setTimeout fallback.
 *
 * Usage:
 * const ctl = createProgressiveExpandController({
 *   items: arrayOfWorkItems,            // required array of items to process
 *   applyBatch: (batch) => void,        // required; called to apply one batch of items
 *   batchSize: 50,                      // optional; default adaptive based on total
 *   timeSliceMs: 10,                    // optional budget per slice (only used for rIC w/ timeRemaining)
 *   onProgress: ({ processed, total, pct }) => void,  // optional; progress callback
 *   onDone: () => void,                 // optional
 *   onCancel: () => void,               // optional
 * });
 * ctl.start();
 * ctl.cancel();
 *
 * Notes:
 * - The controller is self-contained and can be unit tested without React.
 * - It gracefully falls back to setTimeout(0) if requestIdleCallback is not available.
 */
export function createProgressiveExpandController({
  items,
  applyBatch,
  batchSize,
  timeSliceMs = 10,
  onProgress,
  onDone,
  onCancel,
}) {
  const total = Array.isArray(items) ? items.length : 0;
  const adaptiveBatchSize =
    batchSize ||
    (total <= 300 ? total : total <= 1500 ? 75 : total <= 5000 ? 120 : 200);

  let cancelled = false;
  let started = false;
  let processed = 0;
  let index = 0;
  let scheduleHandle = null;

  const callProgress = () => {
    if (typeof onProgress === "function") {
      const pct = total ? Math.min(100, Math.round((processed / total) * 100)) : 100;
      try {
        onProgress({ processed, total, pct });
      } catch {
        // ignore callback errors
      }
    }
  };

  const _processSlice = (deadline /* IdleDeadline */) => {
    if (cancelled) return;
    // Keep applying batches while we have time remaining (for requestIdleCallback), otherwise single batch per slice
    let didAny = false;
    const hasDeadline = deadline && typeof deadline.timeRemaining === "function";
    const shouldContinue = () => {
      if (!hasDeadline) return !didAny; // in setTimeout fallback, only one batch per tick
      return deadline.timeRemaining() > timeSliceMs; // try to respect a small budget to keep UI responsive
    };

    while (index < total) {
      const nextIndex = Math.min(index + adaptiveBatchSize, total);
      const batch = items.slice(index, nextIndex);
      try {
        applyBatch(batch);
      } catch {
        // ignore apply errors to avoid crashing UI
      }
      processed += batch.length;
      index = nextIndex;
      didAny = true;
      callProgress();

      if (cancelled) return;
      if (!shouldContinue()) break;
    }

    if (index >= total) {
      // done
      if (typeof onDone === "function") {
        try {
          onDone();
        } catch {}
      }
      return;
    }
    _scheduleNext();
  };

  const _scheduleNext = () => {
    if (cancelled) return;
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      scheduleHandle = window.requestIdleCallback(_processSlice, { timeout: 50 });
    } else {
      scheduleHandle = setTimeout(() => _processSlice(), 0);
    }
  };

  const start = () => {
    if (started) return;
    started = true;
    if (!total) {
      // nothing to do
      callProgress();
      if (typeof onDone === "function") {
        try {
          onDone();
        } catch {}
      }
      return;
    }
    callProgress(); // initial 0% progress
    _scheduleNext();
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    try {
      if (typeof window !== "undefined" && typeof window.cancelIdleCallback === "function" && scheduleHandle) {
        window.cancelIdleCallback(scheduleHandle);
      } else if (scheduleHandle) {
        clearTimeout(scheduleHandle);
      }
    } catch {}
    if (typeof onCancel === "function") {
      try {
        onCancel();
      } catch {}
    }
  };

  return {
    start,
    cancel,
    get processed() {
      return processed;
    },
    get total() {
      return total;
    },
  };
}

/**
 * PUBLIC_INTERFACE
 * useProgressiveExpand
 * React hook wrapper that manages UI state (running/progress) around the createProgressiveExpandController.
 *
 * API:
 * const {
 *   running, progress, counts, startFromItems, cancel
 * } = useProgressiveExpand({
 *   applyBatch: (batch) => void,
 *   batchSize?: number,
 *   timeSliceMs?: number,
 *   onDone?: () => void,
 *   onCancel?: () => void,
 *   autoCancelOnUnmount?: boolean (default true)
 * });
 *
 * - startFromItems(items: any[]): begins progressive processing.
 * - cancel(): cancels the in-flight processing.
 */
export default function useProgressiveExpand({
  applyBatch,
  batchSize,
  timeSliceMs,
  onDone,
  onCancel,
  autoCancelOnUnmount = true,
} = {}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [counts, setCounts] = useState({ processed: 0, total: 0 });

  const controllerRef = useRef(null);

  const cancel = useCallback(() => {
    controllerRef.current?.cancel?.();
  }, []);

  useEffect(() => {
    if (!autoCancelOnUnmount) return;
    return () => {
      try {
        controllerRef.current?.cancel?.();
      } catch {}
    };
  }, [autoCancelOnUnmount]);

  const startFromItems = useCallback(
    (items) => {
      // Reset state
      setRunning(true);
      setProgress(0);
      setCounts({ processed: 0, total: Array.isArray(items) ? items.length : 0 });

      controllerRef.current = createProgressiveExpandController({
        items: Array.isArray(items) ? items : [],
        applyBatch: (batch) => {
          try {
            applyBatch?.(batch);
          } catch {}
        },
        batchSize,
        timeSliceMs,
        onProgress: ({ processed, total, pct }) => {
          setCounts({ processed, total });
          setProgress(pct);
        },
        onDone: () => {
          setRunning(false);
          setProgress(100);
          try {
            onDone?.();
          } catch {}
        },
        onCancel: () => {
          setRunning(false);
          try {
            onCancel?.();
          } catch {}
        },
      });

      controllerRef.current.start();
    },
    [applyBatch, batchSize, timeSliceMs, onDone, onCancel]
  );

  return {
    running,
    progress, // 0..100
    counts, // { processed, total }
    startFromItems,
    cancel,
  };
}
