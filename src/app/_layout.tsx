import { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { migrate } from '../db/schema';
import { AppProvider } from '../lib/store';
import { colors } from '../components/ui';

function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <Suspense fallback={<Loading />}>
      <SQLiteProvider databaseName="expenses.db" onInit={migrate} useSuspense>
        <AppProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerShadowVisible: false,
              headerTintColor: colors.primary,
              headerTitleStyle: { color: colors.text },
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="expense/[id]" options={{ presentation: 'modal', title: 'Expense' }} />
            <Stack.Screen name="person/[id]" options={{ title: '' }} />
            <Stack.Screen name="categories" options={{ title: 'Categories' }} />
            <Stack.Screen name="login" options={{ presentation: 'modal', title: 'Account' }} />
            <Stack.Screen name="statement" options={{ title: 'Import statement' }} />
          </Stack>
        </AppProvider>
      </SQLiteProvider>
    </Suspense>
  );
}
