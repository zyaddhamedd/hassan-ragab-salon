export const productsCacheByBranch: Record<number, any[]> = {};

export const invalidateProductsCacheForBranch = (branchId?: number): void => {
  if (typeof branchId === 'number') {
    delete productsCacheByBranch[branchId];
    return;
  }

  Object.keys(productsCacheByBranch).forEach((key) => {
    delete productsCacheByBranch[Number(key)];
  });
};

export const getProductsForBranch = async (
  branchId: number,
  fetchFn: () => Promise<any[]>,
  options: { forceRefresh?: boolean } = {}
): Promise<any[]> => {
  if (!options.forceRefresh && productsCacheByBranch[branchId]) {
    return productsCacheByBranch[branchId];
  }

  const data = await fetchFn();
  productsCacheByBranch[branchId] = data;
  return data;
};
