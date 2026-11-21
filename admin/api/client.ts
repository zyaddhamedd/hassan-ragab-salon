/**
 * Admin API Client
 *
 * Axios instance configured for Admin backend communication.
 * - Base URL: /api/admin
 * - Automatically injects JWT access token on every request
 * - On 401: attempts token refresh, replays original request once, or redirects to login
 */

import axios from 'axios';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5001') + '/api/admin';

// Create axios instance
const adminApi = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
});

// ─── Request interceptor — inject access token ────────────────────────────────
adminApi.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('admin_token');
        if (token) config.headers.Authorization = `Bearer ${token}`;
        if (config.data instanceof FormData) delete config.headers['Content-Type'];
        return config;
    },
    (error) => Promise.reject(error)
);

// ─── Refresh state guard ──────────────────────────────────────────────────────
let isRefreshing = false;
let pendingQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

const processQueue = (err: unknown, token: string | null) => {
    pendingQueue.forEach(p => (err ? p.reject(err) : p.resolve(token!)));
    pendingQueue = [];
};

const forceLogout = () => {
    console.warn('[AUTH] Admin: refresh failed — logging out');
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_refresh_token');
    localStorage.removeItem('admin_user');
    window.location.href = '/';
};

// ─── Response interceptor — 401 refresh + retry ───────────────────────────────
adminApi.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Only intercept 401s that haven't already been retried
        if (error.response?.status !== 401 || originalRequest._retried) {
            return Promise.reject(error);
        }

        // If another refresh is in flight, queue this request
        if (isRefreshing) {
            return new Promise((resolve, reject) => {
                pendingQueue.push({
                    resolve: (newToken) => {
                        originalRequest.headers.Authorization = `Bearer ${newToken}`;
                        resolve(adminApi(originalRequest));
                    },
                    reject,
                });
            });
        }

        originalRequest._retried = true;
        isRefreshing = true;

        try {
            const refreshToken = localStorage.getItem('admin_refresh_token');
            if (!refreshToken) throw new Error('No refresh token');

            console.log('[AUTH] Admin: attempting token refresh...');

            const { data } = await axios.post(
                `${API_BASE_URL}/auth/refresh`,
                {},
                { headers: { Authorization: `Bearer ${refreshToken}` } }
            );

            const newAccessToken: string = data.access_token;
            localStorage.setItem('admin_token', newAccessToken);
            console.log('[AUTH] Admin: token refreshed successfully');

            processQueue(null, newAccessToken);

            // Replay the original request with the new token
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            return adminApi(originalRequest);
        } catch (refreshErr) {
            processQueue(refreshErr, null);
            forceLogout();
            return Promise.reject(refreshErr);
        } finally {
            isRefreshing = false;
        }
    }
);

export default adminApi;
