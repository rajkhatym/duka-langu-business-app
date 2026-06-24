import { Stack } from 'expo-router';

import { Colors } from '@/constants/colors';

export default function ProfileLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { color: Colors.text },
        headerTintColor: Colors.primary,
      }}>
      <Stack.Screen name="index" options={{ title: 'Wasifu' }} />
      <Stack.Screen name="users" options={{ title: 'Watumiaji' }} />
      <Stack.Screen name="audit-log" options={{ title: 'Audit Log' }} />
      <Stack.Screen name="daily-audit" options={{ title: 'Daily Audit Report' }} />
      <Stack.Screen name="company-settings" options={{ title: 'Company Settings' }} />
      <Stack.Screen name="setup-wizard" options={{ title: 'Setup Wizard' }} />
    </Stack>
  );
}
