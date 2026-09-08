import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSpaceSocket } from '@/features/space/useSpaceSocket';
import type { Channel, ChannelMessage, ChannelType } from '@/features/space/space.types';

const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:3000';

export default function ChannelScreen() {
  const params = useLocalSearchParams<{ channelId: string; spaceId?: string; name?: string; type?: string; userId?: string }>();
  const router = useRouter();
  const channelId = String(params.channelId || '');
  const userId = String(params.userId || '');
  const channel: Channel = { id: channelId, name: String(params.name || 'channel'), type: (params.type === 'voice' ? 'voice' : 'text') as ChannelType, is_archived: false };
  const [history, setHistory] = useState<ChannelMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [voiceActive, setVoiceActive] = useState(false);
  const socket = useSpaceSocket({ serverUrl: backendUrl, spaceId: String(params.spaceId || ''), userId: userId || undefined });

  useEffect(() => {
    if (!channelId || !userId) return;
    socket.joinChannel(channelId);
    fetch(`${backendUrl}/api/channels/${channelId}/messages?user_id=${encodeURIComponent(userId)}`)
      .then((response) => response.json())
      .then((payload) => setHistory(Array.isArray(payload.messages) ? payload.messages : []))
      .catch(() => setHistory([]));
  }, [channelId, socket.joinChannel, userId]);

  const messages = useMemo(() => [...history, ...socket.channelMessages.filter((message) => message.channel_id === channelId && !history.some((entry) => entry.id === message.id))], [history, socket.channelMessages, channelId]);
  const send = () => { const message = draft.trim(); if (!message) return; socket.sendChannelMessage(channelId, message); setDraft(''); };
  const toggleVoice = () => { if (voiceActive) socket.leaveVoice(channelId); else socket.joinVoice(channelId); setVoiceActive((current) => !current); };

  return <SafeAreaView style={styles.safeArea}>
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {sidebarOpen && <View style={styles.sidebar}><View style={styles.sidebarTop}><Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityLabel="Back"><SymbolView name="chevron.left" tintColor="#F8FAFC" size={20} /></Pressable><Text style={styles.sidebarTitle}>Workspace</Text></View><Text style={styles.sidebarLabel}>CHANNEL</Text><View style={styles.selectedChannel}><Text style={styles.channelGlyph}>{channel.type === 'voice' ? '◉' : '#'}</Text><Text style={styles.selectedName}>{channel.name}</Text></View><View style={styles.sidebarFooter}><Text style={styles.muted}>{socket.connected ? 'Connected' : 'Connecting...'}</Text></View></View>}
      <View style={styles.chatPane}><View style={styles.chatTop}><Pressable onPress={() => setSidebarOpen((open) => !open)} style={styles.iconButton} accessibilityLabel="Toggle sidebar"><SymbolView name="sidebar.left" tintColor="#F8FAFC" size={20} /></Pressable><View style={styles.flex}><Text style={styles.chatTitle}>{channel.type === 'voice' ? '◉' : '#'} {channel.name}</Text><Text style={styles.muted}>Private channel</Text></View>{channel.type === 'voice' && <Pressable onPress={toggleVoice} style={[styles.voiceButton, voiceActive && styles.voiceActive]}><SymbolView name={voiceActive ? 'phone.down.fill' : 'phone.fill'} tintColor="#F8FAFC" size={17} /><Text style={styles.buttonText}>{voiceActive ? 'Leave' : 'Join'}</Text></Pressable>}</View><ScrollView style={styles.messages} contentContainerStyle={styles.messageContent} keyboardShouldPersistTaps="handled">{messages.length === 0 ? <View style={styles.empty}><SymbolView name="bubble.left.and.bubble.right" tintColor="#64748B" size={28} /><Text style={styles.muted}>No messages yet</Text></View> : messages.map((message) => <View key={message.id} style={styles.message}><Text style={styles.sender}>{message.sender_id}</Text><Text style={styles.body}>{message.body || 'Attachment'}</Text><Text style={styles.time}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text></View>)}</ScrollView>{channel.type === 'text' && <View style={styles.composer}><Pressable style={styles.iconButton} accessibilityLabel="Add attachment"><SymbolView name="plus" tintColor="#94A3B8" size={20} /></Pressable><TextInput value={draft} onChangeText={setDraft} onSubmitEditing={send} placeholder="Message #channel" placeholderTextColor="#64748B" style={styles.input} multiline /><Pressable disabled={!draft.trim()} onPress={send} style={[styles.sendButton, !draft.trim() && styles.disabled]} accessibilityLabel="Send message"><SymbolView name="arrow.up" tintColor="#FFFFFF" size={19} /></Pressable></View>}</View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safeArea: { flex: 1, backgroundColor: '#0F172A' }, page: { flex: 1, flexDirection: 'row' }, sidebar: { width: 220, backgroundColor: '#111827', borderRightColor: '#334155', borderRightWidth: 1, padding: 14 }, sidebarTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 28 }, sidebarTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '800' }, sidebarLabel: { color: '#64748B', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 10 }, selectedChannel: { minHeight: 44, backgroundColor: '#1E293B', borderColor: '#6366F1', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, channelGlyph: { color: '#A5B4FC', fontWeight: '800' }, selectedName: { color: '#F8FAFC', fontWeight: '700', flex: 1 }, sidebarFooter: { marginTop: 'auto' }, chatPane: { flex: 1, backgroundColor: '#0F172A' }, chatTop: { minHeight: 72, paddingHorizontal: 16, borderBottomColor: '#334155', borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }, iconButton: { minWidth: 44, minHeight: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }, flex: { flex: 1 }, chatTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '800' }, muted: { color: '#94A3B8', fontSize: 12, marginTop: 3 }, voiceButton: { minHeight: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#6366F1', flexDirection: 'row', alignItems: 'center', gap: 7 }, voiceActive: { backgroundColor: '#EF4444' }, buttonText: { color: '#FFF', fontSize: 12, fontWeight: '800' }, messages: { flex: 1 }, messageContent: { padding: 16, gap: 10, flexGrow: 1, justifyContent: 'flex-end' }, message: { maxWidth: '85%', alignSelf: 'flex-start', backgroundColor: '#1E293B', borderColor: '#334155', borderWidth: 1, borderRadius: 12, padding: 11 }, sender: { color: '#A5B4FC', fontSize: 11, fontWeight: '800' }, body: { color: '#F8FAFC', fontSize: 14, marginTop: 4 }, time: { color: '#64748B', fontSize: 10, marginTop: 5 }, empty: { alignItems: 'center', justifyContent: 'center', gap: 8, flex: 1 }, composer: { minHeight: 68, borderTopColor: '#334155', borderTopWidth: 1, padding: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 5 }, input: { flex: 1, minHeight: 48, maxHeight: 110, borderRadius: 12, backgroundColor: '#1E293B', borderColor: '#334155', borderWidth: 1, color: '#F8FAFC', paddingHorizontal: 12, paddingVertical: 12 }, sendButton: { minWidth: 48, minHeight: 48, borderRadius: 12, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center' }, disabled: { backgroundColor: '#334155' } });
