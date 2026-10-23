export const CONFIG = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  systemName: 'KMSA Management System',
  cycleLabel: import.meta.env.VITE_CYCLE_LABEL || 'KMSA 28',
  timezone: 'Africa/Khartoum',
};

export function assertConfig() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
    throw new Error('إعدادات Supabase غير موجودة. راجع VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY.');
  }
}
