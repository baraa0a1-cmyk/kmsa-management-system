import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { currentProfile } from '../lib/api';
import type { Profile } from '../lib/types';

type AuthState={session:Session|null; profile:Profile|null; loading:boolean; refreshProfile:()=>Promise<void>};
const C=createContext<AuthState>({session:null,profile:null,loading:true,refreshProfile:async()=>{}});
export function AuthProvider({children}:{children:React.ReactNode}){
  const [session,setSession]=useState<Session|null>(null); const [profile,setProfile]=useState<Profile|null>(null); const [loading,setLoading]=useState(true);
  async function load(s:Session|null){setSession(s); if(!s){setProfile(null);setLoading(false);return;} try{setProfile(await currentProfile());}finally{setLoading(false)}}
  useEffect(()=>{supabase.auth.getSession().then(({data})=>load(data.session)); const {data}=supabase.auth.onAuthStateChange((_e,s)=>load(s)); return()=>data.subscription.unsubscribe()},[]);
  const value=useMemo(()=>({session,profile,loading,refreshProfile:async()=>{if(session)setProfile(await currentProfile())}}),[session,profile,loading]);
  return <C.Provider value={value}>{children}</C.Provider>
}
export const useAuth=()=>useContext(C);
