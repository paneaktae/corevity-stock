import { z } from 'zod';

export const messengerAutomationInput = z
  .object({
    enabled: z.boolean(),
    welcomeText: z.string().trim().min(1).max(640),
    contactLabel: z.string().trim().min(1).max(20),
    acknowledgmentText: z.string().trim().min(1).max(640),
    defaultSalespersonEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .or(z.literal('')),
    approvedByHuman: z.literal(true),
  })
  .strict();
export const messengerDefaults = {
  enabled: false,
  welcomeText:
    'สวัสดีครับ ยินดีต้อนรับสู่ Corevity สนใจอุปกรณ์ชิ้นไหน สอบถามได้เลยครับ',
  contactLabel: 'ติดต่อเซล',
  acknowledgmentText:
    'ได้รับคำขอติดต่อเซลแล้วครับ ทีมงานจะติดต่อกลับโดยเร็วครับ',
  defaultSalespersonEmail: '',
};
export type MessengerAutomationSettings = typeof messengerDefaults;
export const messengerActions = {
  start: 'COREVITY_GET_STARTED',
  contact: 'COREVITY_CONTACT_SALES',
} as const;
