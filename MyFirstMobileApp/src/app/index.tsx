import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import SpaceDashboardScreen from '../features/space/SpaceDashboardScreen';

const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:3000';

export default function HomeScreen() {
	const [authenticated, setAuthenticated] = useState(false);
	const [userId, setUserId] = useState('');
	const [signupMode, setSignupMode] = useState(false);
	const [identifier, setIdentifier] = useState('');
	const [username, setUsername] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [bio, setBio] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	if (authenticated) return <SpaceDashboardScreen userId={userId} />;

	async function login() {
		if (!identifier || !password) return setError('Enter your username or email and password.');
		setBusy(true);
		setError('');
		try {
			const response = await fetch(`${backendUrl}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ identifier, password }),
			});
			if (!response.ok) throw new Error('Invalid credentials');
			const payload = await response.json();
			setUserId(payload.user?.id || '');
			setAuthenticated(true);
		} catch (loginError) {
			setError(loginError instanceof Error ? loginError.message : 'Unable to sign in');
		} finally {
			setBusy(false);
		}
	}

	async function signup() {
		if (!username || !displayName || !email || !password) return setError('Complete username, display name, email, and password.');
		setBusy(true);
		setError('');
		try {
			const response = await fetch(`${backendUrl}/api/auth/signup`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, display_name: displayName, email, password, bio }),
			});
			if (!response.ok) {
				const payload = await response.json().catch(() => ({}));
				throw new Error(payload.error || 'Unable to create account');
			}
			const payload = await response.json();
			setUserId(payload.user?.id || '');
			setAuthenticated(true);
		} catch (signupError) {
			setError(signupError instanceof Error ? signupError.message : 'Unable to create account');
		} finally {
			setBusy(false);
		}
	}

	return (
		<View style={styles.page}>
			<View style={styles.form}>
				<Text style={styles.kicker}>Private workspace</Text>
				<Text style={styles.title}>{signupMode ? 'Create your Sigma account' : 'Sign in to Sigma'}</Text>
				<Text style={styles.subtitle}>{signupMode ? 'Create an account before joining a workspace.' : 'Your spaces appear after authentication.'}</Text>
				{signupMode ? <>
					<TextInput autoCapitalize="none" placeholder="Username" placeholderTextColor="#64748B" value={username} onChangeText={setUsername} style={styles.input} />
					<TextInput placeholder="Display name" placeholderTextColor="#64748B" value={displayName} onChangeText={setDisplayName} style={styles.input} />
					<TextInput autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor="#64748B" value={email} onChangeText={setEmail} style={styles.input} />
					<TextInput placeholder="Bio (optional)" placeholderTextColor="#64748B" value={bio} onChangeText={setBio} style={styles.input} />
				</> : <TextInput autoCapitalize="none" placeholder="Username or email" placeholderTextColor="#64748B" value={identifier} onChangeText={setIdentifier} style={styles.input} />}
				<TextInput secureTextEntry placeholder="Password" placeholderTextColor="#64748B" value={password} onChangeText={setPassword} style={styles.input} />
				{!!error && <Text style={styles.error}>{error}</Text>}
				<Pressable disabled={busy} onPress={signupMode ? signup : login} style={styles.button}><Text style={styles.buttonText}>{busy ? 'Please wait...' : signupMode ? 'Create account' : 'Sign in'}</Text></Pressable>
				<Pressable disabled={busy} onPress={() => { setSignupMode(!signupMode); setError(''); }} style={styles.switchButton}><Text style={styles.switchText}>{signupMode ? 'Already have an account? Sign in' : 'New here? Create an account'}</Text></Pressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	page: { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', padding: 24 },
	form: { backgroundColor: '#1E293B', borderColor: '#334155', borderWidth: 1, borderRadius: 16, padding: 20, gap: 12 },
	kicker: { color: '#A5B4FC', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
	title: { color: '#F8FAFC', fontSize: 28, fontWeight: '800' },
	subtitle: { color: '#94A3B8', fontSize: 13, marginBottom: 8 },
	input: { minHeight: 48, borderRadius: 10, borderColor: '#334155', borderWidth: 1, backgroundColor: '#0F172A', color: '#F8FAFC', paddingHorizontal: 14 },
	error: { color: '#FCA5A5', fontSize: 12 },
	button: { minHeight: 48, borderRadius: 10, backgroundColor: '#6366F1', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
	buttonText: { color: '#FFF', fontWeight: '800' },
	switchButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
	switchText: { color: '#A5B4FC', fontSize: 12, fontWeight: '700' },
});
