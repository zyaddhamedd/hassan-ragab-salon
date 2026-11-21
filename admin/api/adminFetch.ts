const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const ADMIN_API_BASE_URL = `${API_BASE_URL}/api/admin`;

const clearAdminSession = () => {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_refresh_token');
  localStorage.removeItem('admin_user');
};

const forceLogout = () => {
  clearAdminSession();
  window.location.href = '/';
};

const withAuthHeaders = (headers?: HeadersInit, token?: string | null) => {
  const nextHeaders = new Headers(headers || {});
  if (token && !nextHeaders.has('Authorization')) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }
  return nextHeaders;
};

const refreshAdminAccessToken = async (): Promise<string | null> => {
  const refreshToken = localStorage.getItem('admin_refresh_token');
  if (!refreshToken) {
    return null;
  }

  const response = await fetch(`${ADMIN_API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${refreshToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const accessToken = payload?.access_token;
  if (!accessToken) {
    return null;
  }

  localStorage.setItem('admin_token', accessToken);
  return accessToken;
};

export const adminFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const originalToken = localStorage.getItem('admin_token');
  const execute = (token?: string | null) =>
    fetch(input, {
      ...init,
      headers: withAuthHeaders(init.headers, token),
    });

  let response = await execute(originalToken);
  if (response.status !== 401) {
    return response;
  }

  const refreshedToken = await refreshAdminAccessToken();
  if (!refreshedToken) {
    forceLogout();
    return response;
  }

  response = await execute(refreshedToken);
  if (response.status === 401) {
    forceLogout();
  }

  return response;
};
