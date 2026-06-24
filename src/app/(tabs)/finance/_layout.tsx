import { Stack } from 'expo-router';

import { Colors } from '@/constants/colors';

export default function FinanceLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { color: Colors.text },
        headerTintColor: Colors.primary,
      }}>
      <Stack.Screen name="index" options={{ title: 'Finance' }} />
      <Stack.Screen name="expenses" options={{ title: 'Matumizi yote' }} />
      <Stack.Screen name="new-expense" options={{ title: 'Rekodi Matumizi', presentation: 'modal' }} />
      <Stack.Screen name="operation-cash" options={{ title: 'Operation Cash Injection', presentation: 'modal' }} />
      <Stack.Screen name="new-debt" options={{ title: 'Rekodi Deni', presentation: 'modal' }} />
      <Stack.Screen name="daily-closing" options={{ title: 'Daily Closing', presentation: 'modal' }} />
      <Stack.Screen name="ledgers" options={{ title: 'Ledgers' }} />
      <Stack.Screen name="quotations" options={{ title: 'Quotations' }} />
      <Stack.Screen name="export" options={{ title: 'Backup / Export' }} />
      <Stack.Screen name="layaways" options={{ title: 'Layaway / Installments' }} />
      <Stack.Screen name="warranty-claims" options={{ title: 'Warranty Claims' }} />
    </Stack>
  );
}
