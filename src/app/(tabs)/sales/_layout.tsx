import { Stack } from 'expo-router';

import { Colors } from '@/constants/colors';

export default function SalesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { color: Colors.text },
        headerTintColor: Colors.primary,
      }}>
      <Stack.Screen name="index" options={{ title: 'Mauzo' }} />
      <Stack.Screen name="new" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="receipt" options={{ title: 'Receipt', presentation: 'modal' }} />
    </Stack>
  );
}
