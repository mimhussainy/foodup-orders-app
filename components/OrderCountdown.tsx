import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useLanguage } from '../lib/useLanguage';

interface Props {
  accepted_at: string;
  accepted_time: string;
}

export default function OrderCountdown({ accepted_at, accepted_time }: Props) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [totalSeconds, setTotalSeconds] = useState<number>(0);
  const { t } = useLanguage();

  useEffect(() => {
    if (!accepted_at || !accepted_time) return;
    if (accepted_time.includes('—') || accepted_time.includes(':')) return;
    const minutes = parseInt(accepted_time.replace(/[^0-9]/g, ''));
    if (isNaN(minutes)) return;
    const acceptedDate = new Date(accepted_at);
    if (isNaN(acceptedDate.getTime())) return;
    const deadlineMs = acceptedDate.getTime() + minutes * 60 * 1000;
    const total = minutes * 60;
    setTotalSeconds(total);
    const update = () => {
      const diff = Math.floor((deadlineMs - Date.now()) / 1000);
      setRemaining(diff);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [accepted_at, accepted_time]);

  if (remaining === null || totalSeconds === 0) return null;

  const mins = Math.floor(Math.abs(remaining) / 60);
  const secs = Math.abs(remaining) % 60;
  const isLate = remaining < 0;
  const percentage = remaining / totalSeconds;
  const color = isLate ? '#e74c3c' : percentage < 0.25 ? '#e74c3c' : percentage < 0.50 ? '#f39c12' : '#2ecc71';
  const progress = Math.max(0, Math.min(1, remaining / totalSeconds));

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="hourglass-outline" size={14} color={color} />
          <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '700', color }}>
            {isLate
              ? `${mins}m ${secs}s ${t.overdue || 'overdue'}`
              : `${mins}m ${secs}s ${t.remaining || 'remaining'}`}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="checkmark-circle-outline" size={14} color="#8B38CB" />
          <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '600', color: '#8B38CB' }}>
            {accepted_time.replace('Minutes', 'mins')}
          </Text>
          {(() => {
            try {
              const deadlineDate = new Date(
                new Date(accepted_at).getTime() +
                  parseInt(accepted_time.replace(/[^0-9]/g, '')) * 60000
              );
              const hours = String(deadlineDate.getHours()).padStart(2, '0');
              const minutes = String(deadlineDate.getMinutes()).padStart(2, '0');
              return (
                <>
                  <Ionicons name="flash-outline" size={14} color="#8B38CB" />
                  <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '600', color: '#8B38CB' }}>
                    {hours}:{minutes}
                  </Text>
                </>
              );
            } catch (e) {
              return null;
            }
          })()}
        </View>
      </View>
      <View style={{ height: 4, backgroundColor: '#F0F0F0', borderRadius: 2, overflow: 'hidden' }}>
        <View style={{ height: 4, width: `${progress * 100}%`, backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  );
}
