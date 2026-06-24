import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';

import { Colors, Spacing } from '@/constants/colors';
import { useBranch } from '@/lib/branch-context';

export function BranchBar() {
  const { branches, selectedBranch, selectedBranchId, setSelectedBranchId } = useBranch();
  const [open, setOpen] = useState(false);
  const canSwitchBranch = branches.length > 1;

  return (
    <>
      <Pressable
        style={[styles.bar, !canSwitchBranch && styles.barLocked]}
        disabled={!canSwitchBranch}
        onPress={() => setOpen(true)}>
        <View>
          <Text style={styles.label}>Branch</Text>
          <Text style={styles.value}>
            {selectedBranch?.name ?? 'Chagua branch'}
            {canSwitchBranch ? ' ▾' : ''}
          </Text>
        </View>
      </Pressable>

      <Modal
        visible={open && canSwitchBranch}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={styles.scrim} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.title}>Chagua Branch</Text>
            {branches.map((branch) => {
              const active = branch.id === selectedBranchId;
              return (
                <Pressable
                  key={branch.id}
                  style={[styles.option, active && styles.optionActive]}
                  onPress={() => {
                    setSelectedBranchId(branch.id);
                    setOpen(false);
                  }}>
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>
                    {branch.name}
                  </Text>
                  {active ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#C8EBDD',
    backgroundColor: '#F7FFFB',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    justifyContent: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
    shadowColor: Colors.primaryDark,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 4,
  },
  barLocked: {
    opacity: 0.92,
  },
  label: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '500',
  },
  value: {
    color: Colors.primaryDark,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 34, 28, 0.42)',
  },
  sheet: {
    margin: Spacing.lg,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  option: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionActive: {
    borderColor: Colors.primary,
    backgroundColor: '#F1FFF8',
  },
  optionText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '400',
  },
  optionTextActive: {
    color: Colors.primaryDark,
  },
  check: {
    color: Colors.primaryDark,
    fontSize: 18,
    fontWeight: '600',
  },
});
