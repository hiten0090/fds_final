import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 
  import.meta.env.VITE_SUPABASE_URL || 
  'https://zylrxdvbrzgjejfsqryi.supabase.co';

const supabaseAnonKey = 
  import.meta.env.VITE_SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5bHJ4ZHZicnpnamVqZnNxcnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MTUyMzMsImV4cCI6MjEwMDM5MTIzM30.nxT6DWWQDPBUIU59QY27rrLvveD1-ZoACjLMcx0tWe4';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

