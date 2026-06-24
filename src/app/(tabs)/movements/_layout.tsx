import { Stack } from 'expo-router';

import { Colors } from '@/constants/colors';

export default function MovementsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { color: Colors.text },
        headerTintColor: Colors.primary,
      }}>
      <Stack.Screen name="index" options={{ title: 'Stock In/Out' }} />
      <Stack.Screen name="new" options={{ title: 'Rekodi Mzunguko', presentation: 'modal' }} />
      <Stack.Screen name="transfer" options={{ title: 'Hamisha Stock', presentation: 'modal' }} />
      <Stack.Screen name="log-book" options={{ title: 'Store Log Book' }} />
      <Stack.Screen name="purchase" options={{ title: 'Purchase / Supplier', presentation: 'modal' }} />
      <Stack.Screen name="stock-count" options={{ title: 'Stock Count', presentation: 'modal' }} />
      <Stack.Screen name="approvals" options={{ title: 'Stock Approvals' }} />
    </Stack>
  );
}
