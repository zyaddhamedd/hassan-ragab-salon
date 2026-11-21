import {
    ProofChallenge,
    createChallengeAssertion,
    createDpopProof,
    generateAndStoreDeviceProofKey,
    loadRequiredDeviceProofKey,
    tokenRequiresDeviceProof,
} from '../security/deviceProof';

// In production we point at the deployed backend origin.
// In Vite development we prefer same-origin requests and let the dev server proxy
// `/api` and `/uploads` to Flask, which keeps real LAN devices working too.
const configuredBackendUrl = (import.meta.env?.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

export const BACKEND_URL = configuredBackendUrl;
export const API_BASE_URL = configuredBackendUrl ? `${configuredBackendUrl}/api/mini` : '/api/mini';

export type MiniDeviceAccessMode = 'FULL_MINI' | 'INVENTORY_ONLY';
export type MiniDeviceType = 'DESKTOP' | 'MOBILE' | 'TABLET';
export type MiniDeviceCredentialState = 'LEGACY' | 'PENDING_FINALIZATION' | 'CREDENTIAL_ENABLED' | 'REVOKED';
export type MiniDeviceProofState = 'CREDENTIAL_ONLY' | 'PENDING_FINALIZATION' | 'PROOF_ENABLED' | 'REVOKED';

export interface MiniDeviceContext {
    id: number | null;
    device_id: string;
    device_label?: string | null;
    device_type: MiniDeviceType;
    access_mode: MiniDeviceAccessMode;
    is_active: boolean;
    last_seen_at?: string | null;
    credential_state?: MiniDeviceCredentialState;
    proof_state?: MiniDeviceProofState;
    proof_key_version?: number;
}

export const normalizeMiniDeviceContext = (value: unknown): MiniDeviceContext | null => {
    if (!value || typeof value !== 'object') return null;

    const record = value as Record<string, unknown>;
    const deviceType = record.device_type;
    const accessMode = record.access_mode;

    if (
        (deviceType !== 'DESKTOP' && deviceType !== 'MOBILE' && deviceType !== 'TABLET') ||
        (accessMode !== 'FULL_MINI' && accessMode !== 'INVENTORY_ONLY') ||
        typeof record.device_id !== 'string'
    ) {
        return null;
    }

    return {
        id: typeof record.id === 'number' ? record.id : null,
        device_id: record.device_id,
        device_label: typeof record.device_label === 'string' ? record.device_label : null,
        device_type: deviceType,
        access_mode: accessMode,
        is_active: Boolean(record.is_active),
        last_seen_at: typeof record.last_seen_at === 'string' ? record.last_seen_at : null,
        credential_state:
            record.credential_state === 'LEGACY' ||
            record.credential_state === 'PENDING_FINALIZATION' ||
            record.credential_state === 'CREDENTIAL_ENABLED' ||
            record.credential_state === 'REVOKED'
                ? record.credential_state
                : undefined,
        proof_state:
            record.proof_state === 'CREDENTIAL_ONLY' ||
            record.proof_state === 'PENDING_FINALIZATION' ||
            record.proof_state === 'PROOF_ENABLED' ||
            record.proof_state === 'REVOKED'
                ? record.proof_state
                : undefined,
        proof_key_version: typeof record.proof_key_version === 'number'
            ? record.proof_key_version
            : undefined,
    };
};

type ApiErrorPayload = {
    error?: string;
    message?: string;
    details?: string;
    pairing_code?: string;
    pending_enrollment_id?: number;
    expires_at?: string;
    limit_reached?: boolean;
    access_mode?: string | null;
    status?: string;
    credential_state?: string;
    proof_state?: string;
};

export type ApiClientError = Error & ApiErrorPayload & {
    code?: string;
    isUnknownOutcome?: boolean;
    httpStatus?: number;
};

const buildApiError = (fallbackMessage: string, errorData: ApiErrorPayload = {}) => {
    const err = new Error(errorData.message || errorData.details || errorData.error || fallbackMessage) as Error & ApiErrorPayload & { code?: string };
    err.code = errorData.error;
    Object.assign(err, errorData);
    return err;
};

const buildUnknownOutcomeError = (message: string, code: string): ApiClientError => {
    const error = new Error(message) as ApiClientError;
    error.code = code;
    error.isUnknownOutcome = true;
    return error;
};

export const isUnknownOutcomeError = (error: unknown): boolean =>
    Boolean(error && typeof error === 'object' && (error as ApiClientError).isUnknownOutcome);

export const isUnknownPaymentOutcomeError = (error: unknown): boolean => {
    if (isUnknownOutcomeError(error)) return true;
    if (!error || typeof error !== 'object') return false;
    const apiError = error as ApiClientError;
    return Boolean(apiError.httpStatus && apiError.httpStatus >= 500 && apiError.status !== 'FAILED');
};

// ─── Token helpers ───────────────────────────────────────────────────────────

const getAccessToken = (): string | null => localStorage.getItem('mini_token');
const getRefreshToken = (): string | null => localStorage.getItem('mini_refresh_token');
const DEVICE_CONTEXT_KEY = 'mini_device_context';

const emitDeviceContextChange = (deviceContext: MiniDeviceContext | null): void => {
    window.dispatchEvent(new CustomEvent('mini:device-context', { detail: deviceContext }));
};

const setAccessToken = (token: string): void => {
    localStorage.setItem('mini_token', token);
};

export const getStoredDeviceContext = (): MiniDeviceContext | null => {
    const raw = localStorage.getItem(DEVICE_CONTEXT_KEY);
    if (!raw) return null;

    try {
        return normalizeMiniDeviceContext(JSON.parse(raw));
    } catch {
        localStorage.removeItem(DEVICE_CONTEXT_KEY);
        return null;
    }
};

export const setStoredDeviceContext = (deviceContext: MiniDeviceContext | null): void => {
    const normalized = normalizeMiniDeviceContext(deviceContext);

    if (!normalized) {
        localStorage.removeItem(DEVICE_CONTEXT_KEY);
        emitDeviceContextChange(null);
        return;
    }

    localStorage.setItem(DEVICE_CONTEXT_KEY, JSON.stringify(normalized));
    emitDeviceContextChange(normalized);
};

const clearTokens = (): void => {
    localStorage.removeItem('mini_token');
    localStorage.removeItem('mini_refresh_token');
    localStorage.removeItem('mini_cashier');
    localStorage.removeItem(DEVICE_CONTEXT_KEY);
};

const DEVICE_ID_KEY = 'mini_device_id';

/**
 * Ensures a persistent UUID exists for this physical device/browser.
 * This ID is used for branch-device binding on the backend.
 * Must be a UUID v4 and persist in localStorage.
 */
export const getOrCreateDeviceId = (): string => {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    
    if (!deviceId) {
        // Use modern crypto API for UUID v4 generation
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            deviceId = crypto.randomUUID();
        } else {
            // Fallback for older environments: manual UUID v4 generation
            deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0;
                const v = c === 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            });
        }
        localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    
    return deviceId;
};

// Exported constant for easy global access
export const DEVICE_ID = getOrCreateDeviceId();

// ─── Refresh state guard (prevents concurrent refresh storms) ─────────────────

let isRefreshing = false;
let pendingQueue: Array<{ resolve: (token: string) => void; errorResolve: (err: any) => void }> = [];

const processQueue = (errRes: any | null, token: string | null) => {
    pendingQueue.forEach(p => (errRes ? p.errorResolve(errRes) : p.resolve(token!)));
    pendingQueue = [];
};

// ─── Network timeout wrapper ──────────────────────────────────────────────────

const safeFetch = async (input: RequestInfo, init: RequestInit = {}): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout
    
    try {
        const res = await fetch(input, { ...init, signal: controller.signal });
        clearTimeout(timeoutId);
        return res;
    } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw buildUnknownOutcomeError(
                'انتهى وقت الاتصال بالخادم (Timeout). جارٍ التحقق من نتيجة العملية.',
                'CLIENT_TIMEOUT',
            );
        }
        throw buildUnknownOutcomeError(
            'مشكلة في الاتصال بالشبكة أو الخادم لا يستجيب. جارٍ التحقق من نتيجة العملية.',
            'NETWORK_ERROR',
        );
    }
};

const responseError = async (response: Response, fallback: string): Promise<ApiClientError> => {
    const errorData = await response.json().catch(() => ({})) as ApiErrorPayload;
    const error = buildApiError(fallback, errorData) as ApiClientError;
    error.httpStatus = response.status;
    return error;
};

const postProofEndpoint = async (
    endpoint: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
): Promise<any> => {
    const response = await safeFetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': DEVICE_ID, ...extraHeaders },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw await responseError(response, 'تعذر إكمال إثبات الجهاز.');
    return response.json();
};

export const prepareLoginDeviceProof = async (): Promise<Record<string, string> | null> => {
    const challenge = await postProofEndpoint(
        '/auth/proof/login-challenge',
        { device_id: DEVICE_ID },
    ) as ProofChallenge;
    if (!challenge.proof_required) return null;
    const key = await loadRequiredDeviceProofKey(DEVICE_ID, challenge.proof_key_thumbprint);
    return {
        challenge_id: challenge.challenge_id!,
        challenge: challenge.challenge!,
        proof: await createChallengeAssertion(challenge, key),
    };
};

export const finalizeDeviceEnrollment = async (enrollmentId: number): Promise<any> => {
    const key = await generateAndStoreDeviceProofKey(DEVICE_ID);
    const challenge = await postProofEndpoint(
        `/auth/device-enrollments/${enrollmentId}/proof-challenge`,
        { device_id: DEVICE_ID, public_key_jwk: key.publicKeyJwk },
    ) as ProofChallenge;
    const proof = await createChallengeAssertion(challenge, key);
    return postProofEndpoint(
        `/auth/device-enrollments/${enrollmentId}/finalize`,
        {
            device_id: DEVICE_ID,
            public_key_jwk: key.publicKeyJwk,
            proof_challenge_id: challenge.challenge_id,
            proof_challenge: challenge.challenge,
            device_proof: proof,
        },
    );
};

// ─── Refresh logic ────────────────────────────────────────────────────────────

const attemptTokenRefresh = async (): Promise<string> => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token available');

    console.log('[AUTH] Mini: attempting token refresh...');

    const refreshHeaders: Record<string, string> = {
        'Authorization': `Bearer ${refreshToken}`,
        'X-Device-ID': DEVICE_ID,
    };
    let refreshBody: Record<string, unknown> | undefined;
    if (tokenRequiresDeviceProof(refreshToken)) {
        const challengeResponse = await safeFetch(`${API_BASE_URL}/auth/proof/refresh-challenge`, {
            method: 'POST',
            headers: refreshHeaders,
            credentials: 'include',
        });
        if (!challengeResponse.ok) {
            throw await responseError(challengeResponse, 'تعذر إصدار تحدي تجديد الجلسة.');
        }
        const challenge = await challengeResponse.json() as ProofChallenge;
        const key = await loadRequiredDeviceProofKey(DEVICE_ID, challenge.proof_key_thumbprint);
        refreshBody = {
            device_proof: {
                challenge_id: challenge.challenge_id,
                challenge: challenge.challenge,
                proof: await createChallengeAssertion(challenge, key),
            },
        };
        refreshHeaders['Content-Type'] = 'application/json';
    }

    const res = await safeFetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: refreshHeaders,
        credentials: 'include',
        body: refreshBody ? JSON.stringify(refreshBody) : undefined,
    });

    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);

    const data = await res.json();
    const newToken: string = data.access_token;
    setAccessToken(newToken);
    setStoredDeviceContext(normalizeMiniDeviceContext(data.device_context));
    console.log('[AUTH] Mini: token refreshed successfully');
    return newToken;
};

const proofRecoveryMessage = (error: unknown): string | undefined => {
    const code = error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
    if (
        code === 'DEVICE_PROOF_KEY_MISSING' ||
        code === 'DEVICE_PROOF_KEY_MISMATCH' ||
        code === 'DEVICE_PROOF_STORAGE_UNAVAILABLE' ||
        code === 'DEVICE_PROOF_REPAIR_REQUIRED'
    ) {
        return 'مفتاح الجهاز الآمن غير موجود أو لا يطابق التسجيل. اطلب من الإدارة إعادة ربط الجهاز.';
    }
    return undefined;
};

const forceLogout = (message?: string): void => {
    console.warn('[AUTH] Mini: refresh failed — logging out');
    clearTokens();
    // Notify App.tsx via a DOM event (keeps this module decoupled from React state)
    window.dispatchEvent(new CustomEvent('auth:logout', { detail: { message } }));
};

// ─── Core fetch wrapper with one-shot 401 refresh ─────────────────────────────

async function fetchWithRefresh(input: RequestInfo, init: RequestInit = {}, refreshSession = true): Promise<Response> {
    const token = refreshSession ? getAccessToken() : null;
    const method = (init.method || 'GET').toUpperCase();
    const requestUrl = typeof input === 'string' ? input : input.url;
    const buildHeaders = async (activeToken: string | null): Promise<Record<string, string>> => ({
        ...(init.headers as Record<string, string> || {}),
        ...(activeToken ? { 'Authorization': `Bearer ${activeToken}` } : {}),
        ...(activeToken && tokenRequiresDeviceProof(activeToken)
            ? { 'DPoP': await createDpopProof(activeToken, DEVICE_ID, method, requestUrl) }
            : {}),
        'X-Device-ID': DEVICE_ID,
    });
    const headers = await buildHeaders(token);

    let res;
    try {
        res = await safeFetch(input, { ...init, headers });
    } catch (e: any) {
        throw e;
    }

    if (res.status !== 401 || !refreshSession) return res;

    // ── 401 received ──────────────────────────────────────────────────────────
    if (isRefreshing) {
        return new Promise<Response>((resolve, reject) => {
            pendingQueue.push({
                resolve: async (newToken) => {
                    try {
                        const retryHeaders = await buildHeaders(newToken);
                        resolve(await safeFetch(input, { ...init, headers: retryHeaders }));
                    } catch (e) {
                        reject(e);
                    }
                },
                errorResolve: (errRes) => reject(new Error("SILENT_AUTH_ERROR")), // Queue fails silently
            });
        });
    }

    isRefreshing = true;
    try {
        const newToken = await attemptTokenRefresh();
        processQueue(null, newToken);

        const retryHeaders = await buildHeaders(newToken);
        return await safeFetch(input, { ...init, headers: retryHeaders });
    } catch (err) {
        processQueue(new Error("SILENT_AUTH_ERROR"), null);
        forceLogout(proofRecoveryMessage(err));
        // Return a never-resolving promise to completely halt UI execution and prevent unhandled rejections
        return new Promise(() => {});
    } finally {
        isRefreshing = false;
    }
}

// ─── Public API client ────────────────────────────────────────────────────────

export const apiClient = {
    get: async (endpoint: string) => {
        try {
            const res = await fetchWithRefresh(`${API_BASE_URL}${endpoint}`, { credentials: 'include' });
            if (!res.ok) {
                if (res.status === 401) { forceLogout(); return new Promise(() => {}); }
                
                // --- SELECTIVE FORCE LOGOUT (DEVICE MISMATCH ONLY) ---
                if (res.status === 403) {
                    const errorData = await res.json().catch(() => ({}));
                    if (errorData.error === "DEVICE_NOT_AUTHORIZED") {
                        forceLogout();
                        return new Promise(() => {});
                    }
                    throw buildApiError(`GET failed: ${res.statusText}`, errorData);
                }

                if (res.status === 404) return []; // Graceful empty state
                const errorData = await res.json().catch(() => ({}));
                throw buildApiError(`GET failed: ${res.statusText}`, errorData as ApiErrorPayload);
            }
            return await res.json();
        } catch (err: any) {
            if (err.message === "SILENT_AUTH_ERROR") return new Promise(() => {});
            throw err;
        }
    },

    post: async (endpoint: string, body: unknown) => {
        try {
            // A rejected login is a form error, not an expired user session.
            const isLogin = endpoint === '/auth/login';
            const isFormData = body instanceof FormData;
            const headers: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' };

            const res = await fetchWithRefresh(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                credentials: 'include',
                headers,
                body: isFormData ? (body as FormData) : JSON.stringify(body),
            }, !isLogin);
            if (!res.ok) {
                if (res.status === 401 && !isLogin) { forceLogout(); return new Promise(() => {}); }

                // --- SELECTIVE FORCE LOGOUT (DEVICE MISMATCH ONLY) ---
                if (res.status === 403) {
                    const errorData = await res.json().catch(() => ({}));
                    if (errorData.error === "DEVICE_NOT_AUTHORIZED") {
                        forceLogout();
                        return new Promise(() => {});
                    }
                    const error = buildApiError(`POST failed: ${res.statusText}`, errorData);
                    (error as ApiClientError).httpStatus = res.status;
                    throw error;
                }

                if (res.status === 404) throw new Error("المورد غير موجود.");
                const errorData = await res.json().catch(() => ({}));
                const error = buildApiError(`POST failed: ${res.statusText}`, errorData as ApiErrorPayload);
                (error as ApiClientError).httpStatus = res.status;
                throw error;
            }
            try {
                return await res.json();
            } catch (error) {
                if (/^\/invoice\/\d+\/confirm$/.test(endpoint)) {
                    throw buildUnknownOutcomeError(
                        'تعذر استلام نتيجة العملية كاملة. جارٍ التحقق من حالة الدفع.',
                        'RESPONSE_BODY_LOST',
                    );
                }
                throw error;
            }
        } catch (err: any) {
            if (err.message === "SILENT_AUTH_ERROR") return new Promise(() => {});
            throw err;
        }
    },

    patch: async (endpoint: string, body: unknown) => {
        try {
            const isFormData = body instanceof FormData;
            const headers: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' };

            const res = await fetchWithRefresh(`${API_BASE_URL}${endpoint}`, {
                method: 'PATCH',
                credentials: 'include',
                headers,
                body: isFormData ? (body as FormData) : JSON.stringify(body),
            });
            if (!res.ok) {
                if (res.status === 401) { forceLogout(); return new Promise(() => {}); }

                // --- SELECTIVE FORCE LOGOUT (DEVICE MISMATCH ONLY) ---
                if (res.status === 403) {
                    const errorData = await res.json().catch(() => ({}));
                    if (errorData.error === "DEVICE_NOT_AUTHORIZED") {
                        forceLogout();
                        return new Promise(() => {});
                    }
                    throw buildApiError(`PATCH failed: ${res.statusText}`, errorData);
                }

                if (res.status === 404) throw new Error("المورد غير موجود.");
                const errorData = await res.json().catch(() => ({}));
                throw buildApiError(`PATCH failed: ${res.statusText}`, errorData as ApiErrorPayload);
            }
            return await res.json();
        } catch (err: any) {
            if (err.message === "SILENT_AUTH_ERROR") return new Promise(() => {});
            throw err;
        }
    },

    delete: async (endpoint: string) => {
        try {
            const res = await fetchWithRefresh(`${API_BASE_URL}${endpoint}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!res.ok) {
                if (res.status === 401) { forceLogout(); return new Promise(() => {}); }

                // --- SELECTIVE FORCE LOGOUT (DEVICE MISMATCH ONLY) ---
                if (res.status === 403) {
                    const errorData = await res.json().catch(() => ({}));
                    if (errorData.error === "DEVICE_NOT_AUTHORIZED") {
                        forceLogout();
                        return new Promise(() => {});
                    }
                    throw buildApiError(`DELETE failed: ${res.statusText}`, errorData);
                }

                if (res.status === 404) throw new Error("المورد غير موجود.");
                const errorData = await res.json().catch(() => ({}));
                throw buildApiError(`DELETE failed: ${res.statusText}`, errorData as ApiErrorPayload);
            }
            return await res.json();
        } catch (err: any) {
            if (err.message === "SILENT_AUTH_ERROR") return new Promise(() => {});
            throw err;
        }
    },
};

export const waitingClient = {
    draw: () => apiClient.post('/waiting/draw', {}),
    getCurrent: () => apiClient.get('/waiting/current'),
    reset: () => apiClient.post('/waiting/reset', {}),
};
