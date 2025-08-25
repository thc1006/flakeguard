import { I18nMessages } from '../types';

import { englishMessages } from './messages/en';
import { chineseMessages } from './messages/zh-TW';

export class I18nManager {
  private messages: I18nMessages;
  private language: 'en' | 'zh-TW';

  constructor(language: 'en' | 'zh-TW' = 'en') {
    this.language = language;
    this.messages = language === 'zh-TW' ? chineseMessages : englishMessages;
  }

  t(key: string, params?: Record<string, any>): string {
    const message = this.getMessage(key);
    
    if (typeof message !== 'string') {
      return key; // Return key if message not found
    }
    
    if (!params) {
      return message;
    }
    
    // Simple parameter replacement
    return message.replace(/\{\{(\w+)\}\}/g, (match, paramKey) => {
      return params[paramKey]?.toString() || match;
    });
  }

  private getMessage(key: string): string | I18nMessages {
    const keys = key.split('.');
    let current: any = this.messages;
    
    for (const k of keys) {
      if (current && typeof current === 'object' && k in current) {
        current = current[k];
      } else {
        return key; // Return key if not found
      }
    }
    
    return current;
  }

  getLanguage(): 'en' | 'zh-TW' {
    return this.language;
  }

  setLanguage(language: 'en' | 'zh-TW'): void {
    this.language = language;
    this.messages = language === 'zh-TW' ? chineseMessages : englishMessages;
  }
}