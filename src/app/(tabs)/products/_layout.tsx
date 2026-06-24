import { Stack } from 'expo-router';

import { Colors } from '@/constants/colors';

export default function ProductsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { color: Colors.text },
        headerTintColor: Colors.primary,
      }}>
      <Stack.Screen name="index" options={{ title: 'Bidhaa' }} />
      <Stack.Screen name="new" options={{ title: 'Ongeza Bidhaa', presentation: 'modal' }} />
      <Stack.Screen name="bundles" options={{ title: 'Bundles' }} />
      <Stack.Screen name="[id]" options={{ title: 'Bidhaa' }} />
    </Stack>
  );
}
