import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!fullName || !email || !password) {
      setError('Tafadhali jaza taarifa zote');
      return;
    }
    if (password.length < 6) {
      setError('Nenosiri linahitaji angalau herufi 6');
      return;
    }
    setError(null);
    setInfo(null);
    setLoading(true);
    const { error: signUpError, needsEmailConfirmation } = await signUp(
      email.trim(),
      password,
      fullName.trim()
    );
    setLoading(false);

    if (signUpError) {
      setError(signUpError);
      return;
    }

    if (needsEmailConfirmation) {
      setInfo('Akaunti imeundwa! Angalia barua pepe yako kuthibitisha kisha uingie.');
      setTimeout(() => router.replace('/(auth)/login'), 2000);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>DL</Text>
        </View>
        <Text style={styles.title}>Fungua Duka Langu</Text>
        <Text style={styles.subtitle}>Anza kurekodi mauzo, stock na madeni</Text>

        <View style={styles.form}>
          <TextField
            label="Jina kamili"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Jina lako"
            autoCapitalize="words"
          />
          <TextField
            label="Barua pepe"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="mfano@godown.com"
          />
          <TextField
            label="Nenosiri"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Angalau herufi 6"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {info ? <Text style={styles.info}>{info}</Text> : null}

          <Button label="Jisajili" onPress={onSubmit} loading={loading} />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Una akaunti tayari?</Text>
            <Link href="/(auth)/login" style={styles.link}>
              Ingia
            </Link>
          </View>
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
  error: {
    color: Colors.danger,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  info: {
    color: Colors.success,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xl,
  },
  footerText: {
    color: Colors.textMuted,
  },
  link: {
    color: Colors.primary,
    fontWeight: '600',
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
