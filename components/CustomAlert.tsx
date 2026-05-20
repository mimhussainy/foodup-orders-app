import { Ionicons } from '@expo/vector-icons';
import { Modal, Text, TouchableOpacity, View } from 'react-native';

interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface CustomAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AlertButton[];
  onClose: () => void;
  icon?: string;
  iconColor?: string;
}

export default function CustomAlert({ visible, title, message, buttons, onClose, icon, iconColor }: CustomAlertProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 24, width: '100%' }}>
          {icon && (
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <Ionicons name={icon as any} size={36} color={iconColor || '#111'} />
            </View>
          )}
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', textAlign: 'center', marginBottom: 8 }}>{title}</Text>
          {message && (
            <Text style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>{message}</Text>
          )}
          <View style={{ gap: 10 }}>
            {buttons.map((btn, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => { onClose(); btn.onPress && btn.onPress(); }}
                style={{
                  borderRadius: 14,
                  padding: 14,
                  alignItems: 'center',
                  backgroundColor: btn.style === 'destructive' ? '#e74c3c' : btn.style === 'cancel' ? '#F5F5F5' : '#111',
                }}
              >
                <Text style={{
                  fontSize: 15,
                  fontWeight: '600',
                  color: btn.style === 'cancel' ? '#111' : '#fff',
                }}>
                  {btn.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}