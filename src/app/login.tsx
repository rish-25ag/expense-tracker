import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { describeNetworkError, supabase, SUPABASE_URL_PROBLEM } from '../lib/supabase';
import { Button, Card, Chip, Field, colors, styles } from '../components/ui';

export default function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Password reset: 'email' = ask for the email, 'code' = enter the emailed code and a new password.
  const [resetStep, setResetStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // The email's link opens a web page to choose a new password; a code works too if the
  // Supabase email template includes {{ .Token }} (custom SMTP).
  const [showCode, setShowCode] = useState(false);

  const sb = supabase;
  if (!sb) return null;

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      return Alert.alert('Check your details', 'Enter your email and a password of at least 6 characters.');
    }
    if (SUPABASE_URL_PROBLEM) return Alert.alert('Supabase is not set up correctly', SUPABASE_URL_PROBLEM);
    setBusy(true);
    const creds = { email: email.trim(), password };
    const { data, error } = mode === 'signin' ? await sb.auth.signInWithPassword(creds) : await sb.auth.signUp(creds);
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

  const startReset = () => {
    setMode('reset');
    setResetStep('email');
    setShowCode(false);
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const sendResetCode = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim()))
      return Alert.alert('Enter your email', 'Use the email you signed up with.');
    if (SUPABASE_URL_PROBLEM) return Alert.alert('Supabase is not set up correctly', SUPABASE_URL_PROBLEM);
    setBusy(true);
    const { error } = await sb.auth.resetPasswordForEmail(email.trim());
    setBusy(false);
    if (error) {
      // Supabase's built-in email service allows only a few emails per hour for the whole project.
      if (error.status === 429 || /rate limit/i.test(error.message)) {
        return Alert.alert(
          'Too many emails for now',
          'Supabase’s free email service sends only a few emails per hour. Check your inbox (and spam) for an earlier one — use the newest — or try again in about an hour.',
        );
      }
      return Alert.alert('Could not send the email', describeNetworkError(error.message));
    }
    setResetStep('code');
  };

  const setPasswordWithCode = async () => {
    const token = code.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token))
      return Alert.alert('Check the code', 'Enter the code from the email (6 or more digits).');
    if (newPassword.length < 6) return Alert.alert('Choose a longer password', 'Use at least 6 characters.');
    if (newPassword !== confirmPassword)
      return Alert.alert('Passwords don’t match', 'Type the same new password twice.');
    setBusy(true);
    // The code signs you in with a recovery session, which is allowed to set a new password.
    const verified = await sb.auth.verifyOtp({ email: email.trim(), token, type: 'recovery' });
    if (verified.error) {
      setBusy(false);
      return Alert.alert(
        'That code didn’t work',
        `${describeNetworkError(verified.error.message)}\n\nCodes expire after a while; you can send a new one.`,
      );
    }
    const updated = await sb.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (updated.error)
      return Alert.alert('Could not set the new password', describeNetworkError(updated.error.message));
    Alert.alert('Password changed', 'You’re signed in with your new password.');
    router.back(); // Signed in: AppProvider picks up the session and syncs.
  };

  if (mode === 'reset') {
    return (
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>Reset your password</Text>
            {resetStep === 'email' ? (
              <>
                <Text style={styles.muted}>We’ll email you a link to choose a new password.</Text>
                <Field
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder="you@example.com"
                />
                <Button title="Send reset link" onPress={sendResetCode} disabled={busy} />
              </>
            ) : (
              <>
                <Text style={styles.muted}>
                  If an account exists for {email.trim()}, an email is on its way (check spam too). Tap the link in it,
                  choose a new password on the page that opens, then come back here and sign in.
                </Text>
                <Button title="I’ve set it — sign in" onPress={() => setMode('signin')} />
                <Button title="Send the email again" variant="ghost" onPress={sendResetCode} disabled={busy} />
                {!showCode ? (
                  <Text
                    onPress={() => setShowCode(true)}
                    accessibilityRole="button"
                    style={{ color: colors.primary, textAlign: 'center', paddingVertical: 4 }}
                  >
                    Got a code instead?
                  </Text>
                ) : null}
              </>
            )}
            {resetStep === 'code' && showCode ? (
              <>
                <Field
                  label="Code from the email"
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  placeholder="123456"
                />
                <Field
                  label="New password"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                />
                <Field
                  label="Confirm new password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoComplete="new-password"
                />
                <Button title="Set new password" onPress={setPasswordWithCode} disabled={busy} />
              </>
            ) : null}
            <Button title="Back to sign in" variant="ghost" onPress={() => setMode('signin')} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

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
          {mode === 'signin' ? (
            <Text
              onPress={startReset}
              accessibilityRole="button"
              style={{ color: colors.primary, textAlign: 'center', paddingVertical: 4 }}
            >
              Forgot password?
            </Text>
          ) : null}
        </Card>
        <Text style={styles.muted}>Expenses already on this phone are uploaded to your account after you sign in.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
