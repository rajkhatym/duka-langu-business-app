import { Stack, router, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '@/constants/colors';
import { AuthProvider, isCashierPreviewMode, isManagerPreviewMode, isOwnerPreviewMode, useAuth } from '@/lib/auth-context';
import { BranchProvider } from '@/lib/branch-context';
import { isSupabaseConfigured } from '@/lib/supabase';

const interFontFamily = Platform.select({
  web: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  default: 'Inter',
});

const textDefaults = Text as unknown as {
  defaultProps?: { style?: unknown };
};
textDefaults.defaultProps = {
  ...textDefaults.defaultProps,
  style: [textDefaults.defaultProps?.style, { fontFamily: interFontFamily }],
};

const textInputDefaults = TextInput as unknown as {
  defaultProps?: { style?: unknown };
};
textInputDefaults.defaultProps = {
  ...textInputDefaults.defaultProps,
  style: [textInputDefaults.defaultProps?.style, { fontFamily: interFontFamily }],
};

export default function RootLayout() {
  return (
    <AuthProvider>
      <BranchProvider>
        <RootNavigator />
      </BranchProvider>
    </AuthProvider>
  );
}

function RootNavigator() {
  const { session, profile, loading } = useAuth();
  const pathname = usePathname();
  const ownerPreviewMode = isOwnerPreviewMode();
  const cashierPreviewMode = isCashierPreviewMode();
  const managerPreviewMode = isManagerPreviewMode();
  const mustChangePassword = Boolean(session && profile?.password_must_change);

  useEffect(() => {
    if (!loading && mustChangePassword && pathname !== '/profile') {
      router.replace('/profile' as never);
    }
  }, [loading, mustChangePassword, pathname]);

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.setup}>
        <Text style={styles.setupTitle}>Supabase haijawekwa</Text>
        <Text style={styles.setupText}>
          Weka EXPO_PUBLIC_SUPABASE_URL na EXPO_PUBLIC_SUPABASE_ANON_KEY kwenye faili la .env,
          kisha build/run app tena.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {session || ownerPreviewMode || cashierPreviewMode || managerPreviewMode ? (
        <Stack.Screen name="(tabs)" />
      ) : (
        <Stack.Screen name="(auth)" />
      )}
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  setup: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: Colors.background,
  },
  setupTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  setupText: {
    color: Colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
