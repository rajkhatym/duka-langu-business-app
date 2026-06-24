export function isMissingCostPriceError(error: { message?: string; details?: string } | null) {
  const text = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
  return text.includes('cost_price') && (text.includes('schema cache') || text.includes('column'));
}
