import { Text } from 'react-native';
import { Tabs } from 'expo-router/tabs';
import { colors } from '../../components/ui';

const icon = (emoji: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.text, fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Expenses', tabBarIcon: icon('🧾') }} />
      <Tabs.Screen name="stats" options={{ title: 'Insights', tabBarIcon: icon('📊') }} />
      <Tabs.Screen name="budgets" options={{ title: 'Budgets', tabBarIcon: icon('🎯') }} />
      <Tabs.Screen name="split" options={{ title: 'Split', tabBarIcon: icon('🤝') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('⚙️') }} />
    </Tabs>
  );
}
