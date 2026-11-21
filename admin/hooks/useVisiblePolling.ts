import { useEffect, useRef } from 'react';


export interface VisiblePollingEnvironment {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  isVisible: () => boolean;
  subscribeVisibility: (listener: () => void) => () => void;
}

interface VisiblePollingControllerOptions {
  poll: () => void | Promise<void>;
  intervalMs: number;
  environment: VisiblePollingEnvironment;
}

export interface VisiblePollingController {
  start: () => void;
  stop: () => void;
  triggerNow: () => Promise<boolean>;
}

export const createVisiblePollingController = ({
  poll,
  intervalMs,
  environment,
}: VisiblePollingControllerOptions): VisiblePollingController => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let started = false;
  let stopped = false;
  let unsubscribeVisibility: (() => void) | null = null;

  const clearScheduledPoll = () => {
    if (timer !== null) {
      environment.clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleNext = () => {
    clearScheduledPoll();
    if (stopped || !environment.isVisible()) return;
    timer = environment.setTimeout(() => {
      timer = null;
      void triggerNow();
    }, intervalMs);
  };

  const triggerNow = async (): Promise<boolean> => {
    if (stopped || inFlight || !environment.isVisible()) return false;
    clearScheduledPoll();
    inFlight = true;
    try {
      await poll();
    } catch {
      // Poll consumers retain their last successful state and retry later.
    } finally {
      inFlight = false;
      scheduleNext();
    }
    return true;
  };

  const handleVisibilityChange = () => {
    if (environment.isVisible()) {
      void triggerNow();
    } else {
      clearScheduledPoll();
    }
  };

  return {
    start: () => {
      if (started) return;
      started = true;
      stopped = false;
      unsubscribeVisibility = environment.subscribeVisibility(handleVisibilityChange);
      scheduleNext();
    },
    stop: () => {
      stopped = true;
      clearScheduledPoll();
      unsubscribeVisibility?.();
      unsubscribeVisibility = null;
    },
    triggerNow,
  };
};

const browserPollingEnvironment = (): VisiblePollingEnvironment => ({
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: timer => window.clearTimeout(timer),
  isVisible: () => document.visibilityState === 'visible',
  subscribeVisibility: listener => {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
});

export const useVisiblePolling = (
  poll: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
) => {
  const pollRef = useRef(poll);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = createVisiblePollingController({
      poll: () => pollRef.current(),
      intervalMs,
      environment: browserPollingEnvironment(),
    });
    controller.start();
    return () => controller.stop();
  }, [enabled, intervalMs]);
};
