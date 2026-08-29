import { useCallback } from 'react';
import { Alert, Platform, Vibration } from 'react-native';

import type { PingLevel, PingPayload } from '@/features/space/space.types';

const defaultPatterns: Record<PingLevel, number[] | number> = {
  0: [],
  1: [200],
  2: [150, 120, 150],
  3: [400, 300, 400, 300, 400],
};

export function usePingEngine() {
  const triggerLocalPing = useCallback((level: PingLevel, payload: PingPayload) => {
    const pattern = defaultPatterns[level];

    if (level > 0 && pattern) {
      Vibration.vibrate(pattern as number | number[]);
    }

    if (level >= 2) {
      Alert.alert(payload.title, payload.message ?? 'New priority update');
    }

    if (Platform.OS === 'android' && level === 3) {
      // This hook intentionally keeps the logic device-native and permission-safe.
      // A production app can route this to expo-notifications or custom alarm logic.
    }
  }, []);

  return { triggerLocalPing };
}
