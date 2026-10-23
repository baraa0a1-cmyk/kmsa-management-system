import { adminClient, anonClient, corsHeaders, json } from '../_shared/common.ts';

async function sha256(v:string){const b=new TextEncoder().encode(v);const h=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('')}

Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 try{
  const {identifier,password}=await req.json();
  const raw=String(identifier||'').trim().toLowerCase(); if(!raw||!password)return json({error:'أدخل البريد/الرقم الجامعي وكلمة السر.'},400);
  const db=adminClient(); const identifierHash=await sha256(raw); const ip=req.headers.get('x-forwarded-for')||req.headers.get('cf-connecting-ip')||''; const ipHash=ip?await sha256(ip):null;
  const since=new Date(Date.now()-10*60*1000).toISOString();
  const {count}=await db.from('login_attempts').select('*',{count:'exact',head:true}).eq('identifier_hash',identifierHash).eq('success',false).gte('created_at',since);
  if((count||0)>=10)return json({error:'محاولات كثيرة. حاول بعد عدة دقائق.'},429);
  let email=raw;
  if(!raw.includes('@')){
    const {data,error}=await db.from('profiles').select('email,active').eq('university_id',raw).maybeSingle();
    if(error||!data||!data.active){await db.from('login_attempts').insert({identifier_hash:identifierHash,ip_hash:ipHash,success:false});return json({error:'بيانات الدخول غير صحيحة.'},401)}
    email=data.email.toLowerCase();
  }
  const auth=anonClient(); const {data,error}=await auth.auth.signInWithPassword({email,password:String(password)});
  const success=!!data.session&&!error; await db.from('login_attempts').insert({identifier_hash:identifierHash,ip_hash:ipHash,success});
  if(!success)return json({error:'بيانات الدخول غير صحيحة.'},401);
  return json({access_token:data.session!.access_token,refresh_token:data.session!.refresh_token,expires_in:data.session!.expires_in});
 }catch(e){console.error(e);return json({error:'تعذر تسجيل الدخول.'},500)}
});
