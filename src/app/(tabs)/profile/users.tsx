import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { supabase } from '@/lib/supabase';
import type { Branch, Profile, UserRole } from '@/types/database';

type StaffActivity = {
  user_id: string;
  last_sign_in_at: string | null;
  sales_today: number;
  expenses_today: number;
  audit_today: number;
};

function roleLabel(role: UserRole) {
  if (role === 'owner' || role === 'admin') return 'Owner';
  if (role === 'manager') return 'Manager';
  return 'Cashier';
}

function nextRole(role: UserRole): UserRole {
  if (role === 'owner' || role === 'admin') return 'manager';
  if (role === 'manager') return 'cashier';
  return 'owner';
}

function branchName(branches: Branch[], branchId?: string | null) {
  return branches.find((branch) => branch.id === branchId)?.name ?? 'Branch haijawekwa';
}

function nextBranchId(branches: Branch[], branchId?: string | null) {
  const branchIds = branches.map((branch) => branch.id);
  if (branchIds.length === 0) return branchId ?? 'adiasports';

  const currentIndex = branchIds.findIndex((id) => id === branchId);
  return branchIds[(currentIndex + 1) % branchIds.length] ?? branchIds[0];
}

export default function UsersScreen() {
  const { profile: currentProfile, isOwner, refreshProfile } = useAuth();
  const { branches } = useBranch();
  const [users, setUsers] = useState<Profile[]>([]);
  const [activityByUser, setActivityByUser] = useState<Record<string, StaffActivity>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data }, activityRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.rpc('get_staff_activity_summary'),
    ]);
    setUsers((data as Profile[]) ?? []);
    const activityRows = (activityRes.data as StaffActivity[] | null) ?? [];
    setActivityByUser(
      activityRows.reduce<Record<string, StaffActivity>>((map, row) => {
        map[row.user_id] = row;
        return map;
      }, {})
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isOwner) {
        router.back();
        return;
      }
      let active = true;
      (async () => {
        setLoading(true);
        await load();
        if (active) setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [isOwner, load])
  );

  const toggleRole = (user: Profile) => {
    const newRole = nextRole(user.role);
    Alert.alert(
      'Badilisha Ruhusa',
      `Una hakika unataka kumfanya "${user.full_name ?? user.id}" ${roleLabel(newRole)}?`,
      [
        { text: 'Ghairi', style: 'cancel' },
        {
          text: 'Badilisha',
          onPress: async () => {
            const { error } = await supabase
              .from('profiles')
              .update({ role: newRole })
              .eq('id', user.id);
            if (error) {
              Alert.alert('Hitilafu', error.message);
              return;
            }
            await load();
            if (user.id === currentProfile?.id) await refreshProfile();
          },
        },
      ]
    );
  };

  const toggleBranch = async (user: Profile) => {
    const branchId = nextBranchId(branches, user.branch_id);
    const { error } = await supabase.from('profiles').update({ branch_id: branchId }).eq('id', user.id);
    if (error) {
      Alert.alert('Hitilafu', error.message);
      return;
    }
    await load();
    if (user.id === currentProfile?.id) await refreshProfile();
  };

  const makeTempPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let suffix = '';
    for (let i = 0; i < 8; i += 1) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return `Staff@${suffix}`;
  };

  const resetPassword = (user: Profile) => {
    if (user.id === currentProfile?.id) {
      Alert.alert('Haiwezekani', 'Huwezi ku-reset password yako mwenyewe hapa. Tumia Badilisha Password kwenye Profile.');
      return;
    }

    const tempPassword = makeTempPassword();
    Alert.alert(
      'Reset Password',
      `Reset password ya "${user.full_name ?? user.id}"? Atalazimika kubadilisha baada ya ku-login.`,
      [
        { text: 'Ghairi', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('owner_reset_staff_password', {
              p_user_id: user.id,
              p_temp_password: tempPassword,
            });
            if (error) {
              Alert.alert('Hitilafu', error.message);
              return;
            }
            await load();
            Alert.alert(
              'Password ya muda',
              `${user.full_name ?? 'Staff'}\nPassword: ${tempPassword}\n\nMtumie password hii, kisha akishaingia abadilishe mara moja.`
            );
          },
        },
      ]
    );
  };

  if (!isOwner) return null;

  if (loading) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            {(() => {
              const isSelf = item.id === currentProfile?.id;
              const canResetPassword = !isSelf && !['owner', 'admin'].includes(item.role);
              const activity = activityByUser[item.id];
              return (
                <>
            <View style={styles.info}>
              <Text style={styles.name}>{item.full_name ?? 'Bila Jina'}</Text>
              <Badge
                label={roleLabel(item.role)}
                tone={item.role === 'owner' || item.role === 'admin' ? 'success' : 'neutral'}
              />
            </View>
            <Text style={styles.branchText}>Branch: {branchName(branches, item.branch_id)}</Text>
            <Text style={styles.branchText}>
              Password: {item.password_must_change ? 'Ya muda, lazima ibadilishwe' : 'Imewekwa'}
            </Text>
            <View style={styles.activityBox}>
              <Text style={styles.activityTitle}>Activity leo</Text>
              <Text style={styles.activityText}>
                Last login: {activity?.last_sign_in_at ? formatDateTime(activity.last_sign_in_at) : 'Bado'}
              </Text>
              <Text style={styles.activityText}>
                Mauzo {activity?.sales_today ?? 0} · Matumizi {activity?.expenses_today ?? 0} · Audit {activity?.audit_today ?? 0}
              </Text>
            </View>
            <View style={styles.actions}>
              <Pressable
                style={[styles.toggleButton, isSelf && styles.toggleButtonDisabled]}
                disabled={isSelf}
                onPress={() => toggleRole(item)}>
                <Text style={styles.toggleText}>Badili Role</Text>
              </Pressable>
              <Pressable style={styles.toggleButton} onPress={() => toggleBranch(item)}>
                <Text style={styles.toggleText}>Badili Branch</Text>
              </Pressable>
              {canResetPassword ? (
                <Pressable style={styles.toggleButton} onPress={() => resetPassword(item)}>
                  <Text style={styles.resetText}>Reset Password</Text>
                </Pressable>
              ) : null}
            </View>
                </>
              );
            })()}
          </View>
        )}
        ListEmptyComponent={<EmptyState title="Hakuna watumiaji" />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  info: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  toggleButton: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.xs,
  },
  toggleButtonDisabled: {
    opacity: 0.35,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.lg,
  },
  branchText: {
    color: Colors.textMuted,
    fontWeight: '400',
  },
  toggleText: {
    color: Colors.primary,
    fontWeight: '400',
    fontSize: 13,
  },
  resetText: {
    color: Colors.danger,
    fontWeight: '600',
    fontSize: 13,
  },
  activityBox: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: 3,
  },
  activityTitle: {
    color: Colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
  activityText: {
    color: Colors.textMuted,
    fontWeight: '400',
    fontSize: 12,
  },
});
