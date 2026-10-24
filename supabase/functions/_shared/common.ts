import { createClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
export const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
export const env=(k:string)=>{const v=Deno.env.get(k);if(!v)throw new Error(`Missing env ${k}`);return v};
export const adminClient=()=>createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
export const anonClient=()=>createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});

export async function requestUser(req:Request){
 const auth=req.headers.get('Authorization')||''; if(!auth.startsWith('Bearer '))throw new Error('UNAUTHORIZED');
 const token=auth.slice(7); const a=anonClient(); const {data,error}=await a.auth.getUser(token); if(error||!data.user)throw new Error('UNAUTHORIZED');
 const db=adminClient(); const {data:p,error:pe}=await db.from('profiles').select('*').eq('auth_user_id',data.user.id).eq('active',true).single(); if(pe||!p)throw new Error('PROFILE_NOT_FOUND');
 return {authUser:data.user,profile:p,db,token};
}
export function hoursFromNow(h:number){return new Date(Date.now()+h*3600000).toISOString()}
export async function setting(db:any,key:string,fallback:any){const {data}=await db.from('system_settings').select('value').eq('key',key).maybeSingle();return data?.value??fallback}
export async function audit(db:any,profile:any,action:string,entityType:string,entityId:string|null,beforeData:any=null,afterData:any=null,meta:any={}){
 await db.from('audit_log').insert({actor_id:profile?.id||null,action,entity_type:entityType,entity_id:entityId,before_data:beforeData,after_data:afterData,meta});
}
export function canManageSecretariat(profile:any,secretariatId:string){return profile.role==='ADMIN'||(profile.role==='SECRETARY'&&profile.secretariat_id===secretariatId)}
export function isGs(profile:any){return profile.role==='GS'||profile.role==='ADMIN'}
export function hasOversight(profile:any){return ['GS','PRESIDENT','ADMIN'].includes(profile.role)}
export function isPresident(profile:any){return profile.role==='PRESIDENT'||profile.role==='ADMIN'}
export async function queueJob(db:any,jobType:string,entityType:string,entityId:string|null,payload:any={}){await db.from('background_jobs').insert({job_type:jobType,entity_type:entityType,entity_id:entityId,payload});}
