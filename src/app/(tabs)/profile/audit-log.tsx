import { useFocusEffect, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { defaultBranches } from '@/lib/branch-context';
import { formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { AuditLog } from '@/types/database';

function branchName(branchId?: string | null) {
  return defaultBranches.find((branch) => branch.id === branchId)?.name ?? 'Branch yote';
}

function actionLabel(action: string) {
  if (action === 'INSERT') return 'Ameongeza';
  if (action === 'UPDATE') return 'Amebadili';
  if (action === 'DELETE') return 'Amefuta';
  return action;
}

export default function AuditLogScreen() {
  const { isOwner } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    setLogs((data as unknown as AuditLog[]) ?? []);
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

  if (!isOwner) return null;

  return (
    <Screen>
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <AuditRow log={item} />}
          ListEmptyComponent={<EmptyState title="Audit log bado haina data" />}
        />
      )}
    </Screen>
  );
}

function AuditRow({ log }: { log: AuditLog }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.title}>{actionLabel(log.action)} {log.table_name}</Text>
        <Text style={styles.branch}>{branchName(log.branch_id)}</Text>
      </View>
      <Text style={styles.meta}>
        {log.actor_id ? `User: ${log.actor_id.slice(0, 8)}` : 'System'} | {formatDateTime(log.created_at)}
      </Text>
      {log.record_id ? <Text style={styles.record}>Record: {log.record_id}</Text> : null}
    </View>
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
  row: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  title: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  branch: {
    color: Colors.primaryDark,
    fontWeight: '600',
    fontSize: 12,
  },
  meta: {
    color: Colors.textMuted,
    fontWeight: '400',
  },
  record: {
    color: Colors.textMuted,
    fontSize: 12,
  },
});
