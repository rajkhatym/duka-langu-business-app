import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import type { UserRole } from '@/types/database';

function roleLabel(role?: UserRole) {
  if (role === 'owner' || role === 'admin') return 'Owner';
  if (role === 'manager') return 'Manager';
  return 'Cashier';
}

export default function ProfileScreen() {
  const { session, profile, isOwner, signOut, refreshProfile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const onLogout = () => {
    Alert.alert('Toka', 'Una hakika unataka kutoka kwenye akaunti?', [
      { text: 'Ghairi', style: 'cancel' },
      { text: 'Toka', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const onChangePassword = async () => {
    const email = session?.user.email?.trim().toLowerCase();
    setPasswordNotice(null);
    setPasswordError(null);

    if (!email) {
      setPasswordError('Akaunti hii haina email ya kuthibitisha password.');
      return;
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('Jaza password ya sasa, mpya na confirmation.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Password mpya iwe na angalau herufi/namba 8.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Password mpya na confirmation hazifanani.');
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordError('Password mpya iwe tofauti na ya sasa.');
      return;
    }

    setChangingPassword(true);
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (verifyError) {
      setChangingPassword(false);
      setPasswordError('Password ya sasa si sahihi.');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setChangingPassword(false);
      setPasswordError(error.message || 'Imeshindikana kubadilisha password.');
      return;
    }

    const { error: flagError } = await supabase.rpc('mark_password_changed');
    setChangingPassword(false);

    if (flagError) {
      setPasswordError(flagError.message || 'Password imebadilishwa lakini status haijasasishwa.');
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordNotice('Password imebadilishwa kikamilifu.');
    await refreshProfile();
  };

  return (
    <Screen>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.name}>{profile?.full_name ?? 'Mtumiaji'}</Text>
          <Text style={styles.email}>{session?.user.email}</Text>
          <Badge
            label={roleLabel(profile?.role)}
            tone={profile?.role === 'owner' || profile?.role === 'admin' ? 'success' : 'neutral'}
          />
        </View>

        <View style={styles.passwordCard}>
          <Text style={styles.sectionTitle}>Badilisha Password</Text>
          <Text style={styles.sectionSubtitle}>
            {profile?.password_must_change
              ? 'Unatumia password ya muda. Badilisha password kabla ya kuendelea kutumia app.'
              : 'Tumia password ya sasa kuthibitisha, kisha weka password mpya.'}
          </Text>
          {profile?.password_must_change ? (
            <View style={styles.mustChangeBanner}>
              <Text style={styles.mustChangeText}>Password change required</Text>
            </View>
          ) : null}
          <TextField
            label="Password ya sasa"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            placeholder="********"
          />
          <TextField
            label="Password mpya"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            placeholder="Angalau herufi/namba 8"
          />
          <TextField
            label="Rudia password mpya"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="Rudia password mpya"
          />
          {passwordError ? <Text style={styles.passwordError}>{passwordError}</Text> : null}
          {passwordNotice ? <Text style={styles.passwordNotice}>{passwordNotice}</Text> : null}
          <Button
            label="Hifadhi Password Mpya"
            onPress={onChangePassword}
            loading={changingPassword}
            style={styles.actionButton}
          />
        </View>

        {isOwner ? (
          <Button
            label="Company Settings"
            variant="secondary"
            onPress={() => router.push('/(tabs)/profile/company-settings' as Href)}
            style={styles.actionButton}
          />
        ) : null}

        {isOwner ? (
          <Button
            label="Simamia Watumiaji"
            variant="secondary"
            onPress={() => router.push('/(tabs)/profile/users')}
            style={styles.actionButton}
          />
        ) : null}

        {isOwner ? (
          <Button
            label="Audit Log"
            variant="secondary"
            onPress={() => router.push('/(tabs)/profile/audit-log' as Href)}
            style={styles.actionButton}
          />
        ) : null}

        {isOwner ? (
          <Button
            label="Daily Audit Report"
            variant="secondary"
            onPress={() => router.push('/(tabs)/profile/daily-audit' as Href)}
            style={styles.actionButton}
          />
        ) : null}

        <Button label="Toka (Logout)" variant="danger" onPress={onLogout} style={styles.actionButton} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  name: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.text,
  },
  email: {
    fontSize: 14,
    color: Colors.textMuted,
    marginBottom: Spacing.xs,
  },
  actionButton: {
    marginBottom: Spacing.md,
  },
  passwordCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    marginBottom: Spacing.lg,
  },
  mustChangeBanner: {
    backgroundColor: '#FFF4E5',
    borderWidth: 1,
    borderColor: '#FFD8A8',
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  mustChangeText: {
    color: '#B45309',
    fontWeight: '400',
  },
  passwordError: {
    color: Colors.danger,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  passwordNotice: {
    color: Colors.success,
    fontWeight: '400',
    marginBottom: Spacing.md,
  },
});
