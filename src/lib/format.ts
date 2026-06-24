export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function formatMoney(value: number | null | undefined): string {
  if (value == null) return '-';
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleString('sw-TZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
