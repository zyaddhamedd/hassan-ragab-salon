import adminApi from './client';
import type { PromoCode, PromoCodePayload, PromoListResponse, PromoOption } from '../types';

export const promoApi = {
  list: async (params: { page: number; per_page: number; search?: string; branch_id?: string; is_active?: string }, signal?: AbortSignal) =>
    (await adminApi.get<PromoListResponse>('/promo-codes', { params, signal })).data,
  options: async (signal?: AbortSignal) => {
    const [categories, branches] = await Promise.all([
      adminApi.get<PromoOption[]>('/service-categories', { signal }),
      adminApi.get<PromoOption[]>('/branches', { signal }),
    ]);
    return { categories: categories.data, branches: branches.data };
  },
  create: async (payload: PromoCodePayload) => (await adminApi.post<PromoCode>('/promo-codes', payload)).data,
  update: async (id: number, payload: Partial<PromoCodePayload>) => (await adminApi.patch<PromoCode>(`/promo-codes/${id}`, payload)).data,
  archive: async (id: number) => (await adminApi.delete<PromoCode>(`/promo-codes/${id}`)).data,
};
