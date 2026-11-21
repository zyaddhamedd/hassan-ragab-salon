export type PaymentPhase = 'IDLE' | 'SUBMITTING' | 'VERIFYING';

export interface PaymentAttemptResult {
  payment_attempt_id: string;
  status: 'NOT_FOUND' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  invoice?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

export type PaymentReconciliationOutcome<TInvoice> =
  | { status: 'SUCCEEDED'; invoice: TInvoice }
  | { status: 'FAILED'; error: unknown }
  | { status: 'UNRESOLVED' };

interface PaymentReconciliationOptions<TInvoice> {
  check: () => Promise<PaymentAttemptResult>;
  resend: () => Promise<TInvoice | { status: 'PROCESSING' }>;
  isUnknownError: (error: unknown) => boolean;
  wait?: () => Promise<void>;
  maxChecks?: number;
}

export const resolvePaymentAttempt = async <TInvoice>({
  check,
  resend,
  isUnknownError,
  wait = () => new Promise(resolve => setTimeout(resolve, 1500)),
  maxChecks = 5,
}: PaymentReconciliationOptions<TInvoice>): Promise<PaymentReconciliationOutcome<TInvoice>> => {
  for (let checkNumber = 0; checkNumber < maxChecks; checkNumber += 1) {
    let result: PaymentAttemptResult | null = null;
    try {
      result = await check();
    } catch {
      // A failed status check cannot establish the payment outcome.
    }

    if (result?.status === 'SUCCEEDED' && result.invoice) {
      return { status: 'SUCCEEDED', invoice: result.invoice as TInvoice };
    }
    if (result?.status === 'FAILED') {
      return { status: 'FAILED', error: result.error };
    }
    if (result?.status === 'NOT_FOUND') {
      try {
        const resendResult = await resend();
        if ((resendResult as { status?: string })?.status !== 'PROCESSING') {
          return { status: 'SUCCEEDED', invoice: resendResult as TInvoice };
        }
      } catch (error) {
        if (!isUnknownError(error)) {
          return { status: 'FAILED', error };
        }
      }
    }

    if (checkNumber < maxChecks - 1) await wait();
  }
  return { status: 'UNRESOLVED' };
};

export const createPaymentAttemptId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = (Math.random() * 16) | 0;
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

export const tryBeginPaymentAttempt = (
  phaseRef: { current: PaymentPhase },
  idFactory: () => string = createPaymentAttemptId,
): string | null => {
  if (phaseRef.current !== 'IDLE') return null;
  phaseRef.current = 'SUBMITTING';
  return idFactory();
};

export const paymentFailureMessage = (error: any): string => {
  if (error?.message) return error.message;
  if (error?.error && typeof error.error === 'string') return error.error;
  return 'تعذر إكمال الدفع. يرجى المحاولة مرة أخرى.';
};
