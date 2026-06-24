export function userFacingError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('row-level security')) {
    return 'Huna ruhusa ya kuhifadhi kwenye Supabase. Ingia kwenye akaunti au update RLS policies.';
  }
  if (lower.includes('cost_price') && lower.includes('schema cache')) {
    return 'Database bado haina column ya cost_price. Run SQL ya kuongeza cost_price kisha refresh app.';
  }
  return message;
}
