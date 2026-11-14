import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { describeNetworkError, supabase, SUPABASE_URL_PROBLEM } from '../lib/supabase';
import { Button, Card, Chip, Field, styles } from '../components/ui';

export default function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const sb = supabase;
  if (!sb) return null;

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      return Alert.alert('Check your details', 'Enter your email and a password of at least 6 characters.');
    }
    if (SUPABASE_URL_PROBLEM) return Alert.alert('Supabase is not set up correctly', SUPABASE_URL_PROBLEM);
    setBusy(true);
    const creds = { email: email.trim(), password };
    const { data, error } =
      mode === 'signin' ? await sb.auth.signInWithPassword(creds) : await sb.auth.signUp(creds);
    setBusy(false);
    if (error) {
      return Alert.alert(mode === 'signin' ? 'Sign in failed' : 'Sign up failed', describeNetworkError(error.message));
    }
    if (mode === 'signup' && !data.session) {
      Alert.alert('Confirm your email', 'We sent you a confirmation link. Open it, then sign in here.');
      setMode('signin');
      return;
    }
    router.back(); // AppProvider picks up the session and syncs.
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Sign in" selected={mode === 'signin'} onPress={() => setMode('signin')} />
          <Chip label="Create account" selected={mode === 'signup'} onPress={() => setMode('signup')} />
        </View>
        <Card>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder="At least 6 characters"
          />
          <Button title={mode === 'signin' ? 'Sign in' : 'Create account'} onPress={submit} disabled={busy} />
        </Card>
        <Text style={styles.muted}>
          Expenses already on this phone are uploaded to your account after you sign in.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
