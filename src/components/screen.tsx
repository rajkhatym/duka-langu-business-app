import { StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/constants/colors';
import { BranchBar } from '@/components/branch-bar';

interface ScreenProps extends ViewProps {
  showBranchBar?: boolean;
}

export function Screen({ style, children, showBranchBar = true, ...rest }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={[styles.container, style]} {...rest}>
        {showBranchBar ? <BranchBar /> : null}
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.primaryDark,
  },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.background,
  },
});
