import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { createContext, useContext, useEffect, useState } from 'react';
import { Language, getTranslation } from './i18n';

interface LanguageContextType {
  language: Language;
  t: ReturnType<typeof getTranslation>;
  changeLanguage: (lang: Language) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  t: getTranslation('en'),
  changeLanguage: async () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('en');
  const [t, setT] = useState(getTranslation('en'));

  useEffect(() => {
    loadLanguage();
  }, []);

  const loadLanguage = async () => {
    const saved = await AsyncStorage.getItem('app_language');
    if (saved) {
      setLanguage(saved as Language);
      setT(getTranslation(saved as Language));
    } else {
      const locale = getLocales()[0]?.languageCode || 'en';
      const lang: Language = locale === 'de' ? 'de' : 'en';
      setLanguage(lang);
      setT(getTranslation(lang));
      await AsyncStorage.setItem('app_language', lang);
    }
  };

  const changeLanguage = async (lang: Language) => {
    setLanguage(lang);
    setT(getTranslation(lang));
    await AsyncStorage.setItem('app_language', lang);
  };

  return (
    <LanguageContext.Provider value={{ language, t, changeLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}