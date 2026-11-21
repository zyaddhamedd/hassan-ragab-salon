/**
 * Admin Authentication Service
 * 
 * Handles login, logout, and session management
 */

import adminApi from './client';

export interface LoginCredentials {
    username: string;
    password: string;
}

export interface AdminUser {
    id: number;
    username: string;
    full_name: string;
    role: 'SUPER_ADMIN' | 'EXEC_ADMIN' | 'BRANCH_MANAGER' | 'STORE_MANAGER';
    branch_id: number | null;
}

export interface LoginResponse {
    access_token: string;
    refresh_token: string;
    user: AdminUser;
}

/**
 * Login admin user
 */
export const login = async (credentials: LoginCredentials): Promise<LoginResponse> => {
    const response = await adminApi.post<LoginResponse>('/auth/login', credentials);
    return response.data;
};

/**
 * Logout admin user
 */
export const logout = (): void => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_refresh_token');
    localStorage.removeItem('admin_user');
};

/**
 * Get current admin user from localStorage
 */
export const getCurrentUser = (): AdminUser | null => {
    const userJson = localStorage.getItem('admin_user');
    if (!userJson) return null;

    try {
        return JSON.parse(userJson);
    } catch {
        return null;
    }
};

/**
 * Check if user is authenticated
 */
export const isAuthenticated = (): boolean => {
    return !!localStorage.getItem('admin_token');
};

/**
 * Save authentication data to localStorage
 */
export const saveAuthData = (token: string, user: AdminUser, refreshToken?: string): void => {
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_user', JSON.stringify(user));
    if (refreshToken) {
        localStorage.setItem('admin_refresh_token', refreshToken);
    }
};
