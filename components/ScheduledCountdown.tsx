import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useLanguage } from '../lib/useLanguage';

interface Props {
  scheduledMs: number;
  at: string;
}

export default function ScheduledCountdown({ scheduledMs, at }: Props) {
  const [now, setNow] = useState(Date.now());
  const { t } = useLanguage();

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const remainingMs = scheduledMs - now;
  const isOverdue = remainingMs < 0;
  const absMs = Math.abs(remainingMs);
  const hours = Math.floor(absMs / 3600000);
  const mins = Math.floor((absMs % 3600000) / 60000);
  const secs = Math.floor((absMs % 60000) / 1000);
  const barColor = isOverdue ? '#e74c3c' : remainingMs < 30 * 60000 ? '#f39c12' : '#8B38CB';
  const showBar = isOverdue || remainingMs <= 3600000;
  const countdownProgress = Math.max(0, Math.min(1, remainingMs / 3600000));

  const label = isOverdue
    ? `${mins}m ${secs}s ${t.overdue || 'overdue'}`
    : hours >= 1
    ? `${hours}h ${mins}m ${t.remaining || 'remaining'}`
    : `${mins}m ${secs}s ${t.remaining || 'remaining'}`;

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="time-outline" size={14} color={barColor} />
          <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '700', color: barColor }}>{label}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="calendar-outline" size={14} color="#8B38CB" />
          <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '600', color: '#8B38CB' }}>
            {(() => {
              const parts = at.split('—');
              if (parts.length < 2) return at;
              const timePart = parts[0].trim();
              const datePart = parts[1].trim();
              const dateSections = datePart.split('/');
              if (dateSections.length < 3) return at;
              const scheduledDate = new Date(`${dateSections[2]}-${dateSections[1]}-${dateSections[0]}`);
              const today = new Date();
              const isToday = scheduledDate.toDateString() === today.toDateString();
              return isToday ? timePart : at;
            })()}
          </Text>
        </View>
      </View>
      {showBar && (
        <View style={{ height: 4, backgroundColor: '#F0F0F0', borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${countdownProgress * 100}%`, backgroundColor: barColor, borderRadius: 2 }} />
        </View>
      )}
    </View>
  );
}
