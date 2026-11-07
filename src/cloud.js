import {createClient} from '@supabase/supabase-js';
import {cloudConfig} from './cloud-config.js';
import {createCloudStore} from './cloud-state.js';

export function createCloudAccount({space,storage,onSnapshot,onUser,onStatus,canSync}){
 const configured=!!cloudConfig.url&&!!cloudConfig.publishableKey;
 const client=configured?createClient(cloudConfig.url,cloudConfig.publishableKey,{auth:{storageKey:'course-tracker-auth:'+space,detectSessionInUrl:true,autoRefreshToken:true,persistSession:true}}):null;
 let store=null,user=null,ready=false,generation=0,recovery=false,changing=Promise.resolve();
 const redirect=location.origin+import.meta.env.BASE_URL;
 async function changeUser(next,event){
  if(event==='PASSWORD_RECOVERY'){recovery=true;location.hash='account';}
  if(ready&&next?.id===user?.id){await changing;if(event==='PASSWORD_RECOVERY')onUser(user,{recovery});return;}
  if(event!=='PASSWORD_RECOVERY')recovery=false;
  ready=true;const turn=++generation;store?.dispose();store=null;user=next||null;
  onUser(user,{switching:true,recovery});
  changing=(async()=>{try{
   if(user){
    const nextStore=createCloudStore({client,userId:user.id,space,storage,canSync,onSnapshot:snapshot=>{if(turn===generation)onSnapshot(snapshot);},onStatus});store=nextStore;
    await nextStore.start();
   }else{const guest=await storage.get('state','main');if(turn===generation){onSnapshot(guest||null);onStatus({state:'local'});}}
  }finally{if(turn===generation)onUser(user,{switching:false,recovery});}})();
  await changing;
 }
 client?.auth.onAuthStateChange((event,session)=>{setTimeout(()=>{void changeUser(session?.user,event).catch(error=>onStatus({state:'error',message:error.message}));},0);});
 const checked=async promise=>{const result=await promise;if(result.error)throw result.error;return result.data;};
 return {
  configured,
  passwordRecoveryEnabled:cloudConfig.passwordRecoveryEnabled===true,
  async start(){if(!client)return;const {data,error}=await client.auth.getSession();if(error)onStatus({state:'error',message:error.message});await changeUser(data?.session?.user,'INITIAL_SESSION');},
  async signIn(email,password){return checked(client.auth.signInWithPassword({email,password}));},
  async signUp(email,password){
   if(cloudConfig.emailConfirmationRequired===false){
    const response=await fetch(cloudConfig.url+'/auth/v1/settings',{headers:{apikey:cloudConfig.publishableKey},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Не удалось проверить доступность регистрации. Попробуйте ещё раз.');
    const settings=await response.json();
    if(settings.mailer_autoconfirm!==true)throw Error('Регистрация без письма ещё не включена на сервере. Владелец сайта должен завершить настройку входа.');
   }
   const data=await checked(client.auth.signUp({email,password,options:{emailRedirectTo:redirect}}));
   if(cloudConfig.emailConfirmationRequired===false&&!data.session)throw Error('Аккаунт не открылся. Попробуйте войти с этим email и паролем; если вход не удаётся, обратитесь к владельцу сайта.');
   return data;
  },
  async resetPassword(email){if(!cloudConfig.passwordRecoveryEnabled)throw Error('Восстановление пароля по почте пока не подключено.');return checked(client.auth.resetPasswordForEmail(email,{redirectTo:redirect}));},
  async updatePassword(password){const data=await checked(client.auth.updateUser({password}));recovery=false;onUser(user,{recovery});return data;},
  async signOut(){await store?.sync();await checked(client.auth.signOut({scope:'local'}));},
  async save(snapshot){if(store)return store.save(snapshot);return storage.put('state','main',snapshot);},
  sync(){return store?.sync();},
 };
}
