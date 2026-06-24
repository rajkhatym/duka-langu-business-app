import { router, Tabs } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/components/app-icon';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';

function TabIcon({
  symbol,
  fallback,
  focused,
  center = false,
}: {
  symbol: AppIconName;
  fallback: string;
  focused: boolean;
  center?: boolean;
}) {
  return (
    <View style={[styles.iconWrap, center && styles.centerIconWrap, focused && !center && styles.iconWrapFocused]}>
      <AppIcon
        name={symbol}
        fallback={fallback}
        size={center ? 30 : 22}
        color={center ? Colors.white : focused ? Colors.primary : Colors.textMuted}
        fallbackStyle={[styles.iconFallback, center && styles.centerIconFallback]}
      />
    </View>
  );
}

function WebReloadTabButton({ href, children, ...props }: { href: string; children: React.ReactNode }) {
  return (
    <Pressable
      {...props}
      onPress={() => {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.location.assign(href);
          return;
        }
        router.push(href as never);
      }}>
      {children}
    </Pressable>
  );
}

export default function TabsLayout() {
  const { isAdmin } = useAuth();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        headerStyle: { backgroundColor: Colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { color: Colors.text, fontWeight: '600' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarButton: (props) => <WebReloadTabButton {...props} href="/" />,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              symbol={{ ios: 'house.fill', android: 'home', web: 'home' }}
              fallback="⌂"
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'Stock',
          headerShown: false,
          tabBarButton: (props) => <WebReloadTabButton {...props} href="/products" />,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              symbol={{ ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }}
              fallback="□"
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="movements"
        options={{
          title: 'Stock',
          headerShown: false,
          href: null,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              symbol={{ ios: 'arrow.left.arrow.right.square.fill', android: 'sync_alt', web: 'sync_alt' }}
              fallback="▣"
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="sales"
        options={{
          title: 'Uza',
          headerShown: false,
          tabBarItemStyle: styles.centerTabItem,
          tabBarLabelStyle: styles.centerTabLabel,
          tabBarButton: (props) => <WebReloadTabButton {...props} href="/sales/new" />,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              symbol={{ ios: 'cart.fill', android: 'point_of_sale', web: 'point_of_sale' }}
              fallback="⌑"
              focused={focused}
              center
            />
          ),
        }}
      />
      <Tabs.Screen
        name="finance"
        options={{
          title: 'Finance',
          headerShown: false,
          href: isAdmin ? undefined : null,
          tabBarButton: isAdmin ? (props) => <WebReloadTabButton {...props} href="/finance" /> : undefined,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              symbol={{
                ios: 'wallet.pass.fill',
                android: 'account_balance_wallet',
                web: 'account_balance_wallet',
              }}
              fallback="▱"
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: 'Docs',
          headerShown: false,
          href: null,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              symbol={{ ios: 'doc.text.fill', android: 'description', web: 'description' }}
              fallback="▧"
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="audit"
        options={{
          title: 'Audit',
          headerShown: false,
          href: null,
          tabBarButton: undefined,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              symbol={{ ios: 'checklist.checked', android: 'fact_check', web: 'fact_check' }}
              fallback="✓"
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Ripoti',
          headerShown: false,
          href: isAdmin ? undefined : null,
          tabBarButton: isAdmin ? (props) => <WebReloadTabButton {...props} href="/reports" /> : undefined,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              symbol={{ ios: 'chart.bar.xaxis', android: 'bar_chart_4_bars', web: 'bar_chart_4_bars' }}
              fallback="▥"
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Wasifu',
          headerShown: false,
          href: null,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              symbol={{ ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' }}
              fallback="W"
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
    height: 84,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderTopWidth: 1,
    borderWidth: 1,
    borderColor: 'rgba(216,233,225,0.95)',
    borderTopColor: 'rgba(216,233,225,0.95)',
    borderRadius: 28,
    shadowColor: Colors.primaryDark,
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 18,
  },
  tabItem: {
    gap: 1,
  },
  centerTabItem: {
    transform: [{ translateY: -18 }],
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  centerTabLabel: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '500',
    marginTop: -8,
  },
  iconWrap: {
    width: 42,
    height: 30,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerIconWrap: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: Colors.surface,
    shadowColor: Colors.primaryDark,
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  iconWrapFocused: {
    backgroundColor: '#DFF5EC',
    borderWidth: 1,
    borderColor: '#BFE8DA',
  },
  iconFallback: {
    fontSize: 26,
    fontWeight: '600',
  },
  centerIconFallback: {
    fontSize: 34,
  },
});
