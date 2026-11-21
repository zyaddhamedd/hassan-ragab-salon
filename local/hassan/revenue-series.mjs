// Recharts may include/reorder decorative and main-series entries.
export function resolveRevenueSeries(payload) {
 if(!Array.isArray(payload))return null;
 const revenue=payload.find(item=>item?.dataKey==='revenue'&&typeof item.value==='number'&&Number.isFinite(item.value));
 const profit=payload.find(item=>item?.dataKey==='net_profit'&&typeof item.value==='number'&&Number.isFinite(item.value));
 if(!revenue||!profit)return null;
 return {revenue:revenue.value,netProfit:profit.value,isForecast:!!revenue.payload?.isForecast};
}
