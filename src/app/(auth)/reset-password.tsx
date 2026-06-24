import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { supabase } from '@/lib/supabase';

function readRecoveryParams() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return {};
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return {
    code: search.get('code'),
    accessToken: hash.get('access_token'),
    refreshToken: hash.get('refresh_token'),
    type: search.get('type') ?? hash.get('type'),
  };
}

export default function ResetPasswordScreen() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>('Inaandaa password reset...');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { code, accessToken, refreshToken } = readRecoveryParams();

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError.message);
          setNotice(null);
          return;
        }
        setReady(true);
        setNotice('Weka password mpya hapa chini.');
        return;
      }

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) {
          setError(sessionError.message);
          setNotice(null);
          return;
        }
        setReady(true);
        setNotice('Weka password mpya hapa chini.');
        return;
      }

      setReady(false);
      setNotice(null);
      setError('Reset link haijakamilika au ime-expire. Tuma reset link mpya.');
    })();
  }, []);

  const onSubmit = async () => {
    if (password.length < 6) {
      setError('Password iwe na herufi/namba angalau 6.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Password hazifanani.');
      return;
    }

    setLoading(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setNotice('Password imebadilishwa. Sasa unaweza ku-login.');
    setPassword('');
    setConfirmPassword('');
    setTimeout(() => router.replace('/(auth)/login'), 1200);
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>DL</Text>
        </View>
        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>Weka password mpya ya akaunti yako.</Text>

        <View style={styles.form}>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <TextField
            label="Password mpya"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Angalau herufi/namba 6"
          />
          <TextField
            label="Rudia password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="Rudia password mpya"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Hifadhi Password Mpya" onPress={onSubmit} loading={loading} disabled={!ready} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
  },
  title: {
    fontSize: 26,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.xs,
    marginBottom: Spacing.xxl,
  },
  form: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  notice: {
    color: Colors.primaryDark,
    fontWeight: '400',
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  error: {
    color: Colors.danger,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  brandMark: {
    width: 58,
    height: 58,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  brandMarkText: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: 18,
  },
});
