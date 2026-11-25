(() => {
  'use strict';
  const $=id=>document.getElementById(id), cfg=window.WORDCARD_CLOUD||{};
  const configured=!!(cfg.url&&cfg.key), redirect=new URL('./',location.href).href;
  const callbackUrl=new URL(location.href), callbackParams=new URLSearchParams(callbackUrl.hash.slice(1));
  const callbackError=callbackParams.get('error_code')||callbackParams.get('error')||callbackUrl.searchParams.get('error_code')||callbackUrl.searchParams.get('error');
  let client, user=null, started=false, starting=false, frozen=false, mode='login', recovery=false;
  let data={},revision=0,dirty=false,timer=0,inflight=null,remoteConflict=null,cacheKey='',poll=0;
  let tabId=sessionStorage.getItem('wordcards-tab');
  if(!tabId){tabId=crypto.randomUUID();sessionStorage.setItem('wordcards-tab',tabId)}
  const clone=x=>JSON.parse(JSON.stringify(x));
  let statusTimer=0;
  const status=(text,bad=false)=>{
    if(!$('syncStatus'))return;
    $('syncStatus').textContent=text;$('syncStatus').classList.toggle('sync-error',bad);
    clearTimeout(statusTimer);
    if($('syncToast')){
      $('syncToast').hidden=false;
      if(!bad&&(text==='已同步'||text==='数据只保存在此浏览器'))statusTimer=setTimeout(()=>{$('syncToast').hidden=true},2800);
    }
  };
  const authMessage=(text,bad=false)=>{$('authStatus').textContent=text;$('authStatus').className='status'+(bad?' err':'')};
  const validData=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.entries(x).every(([k,v])=>k.startsWith('jpcard-')&&typeof v==='string');
  function readGuest(){const result={};for(const k of Object.keys(localStorage))if(k.startsWith('jpcard-')&&k!=='jpcard-mobile-probe')result[k]=localStorage.getItem(k);return result}
  function persist(){
    if(!user)return;
    try{localStorage.setItem(cacheKey,JSON.stringify({data,revision,dirty,userId:user.id,time:Date.now()}))}
    catch{status('本机存储空间不足，请保持页面打开并立即同步',true)}
  }
  function setData(k,value){
    if(frozen||!k.startsWith('jpcard-'))return;
    if(value===null){if(!(k in data))return;delete data[k]}else{value=String(value);if(data[k]===value)return;data[k]=value}
    if(!user){value===null?localStorage.removeItem(k):localStorage.setItem(k,value);return}
    dirty=true;persist();status(remoteConflict?'有冲突，等待选择版本':'等待同步…',!!remoteConflict);
    clearTimeout(timer);if(!remoteConflict)timer=setTimeout(flush,900);
  }
  const storage=new Proxy({
    getItem:k=>Object.hasOwn(data,k)?data[k]:null,
    setItem:(k,v)=>setData(String(k),v), removeItem:k=>setData(String(k),null),
    key:i=>Object.keys(data)[i]??null, clear:()=>Object.keys(data).forEach(k=>setData(k,null))
  },{get:(target,key)=>key==='length'?Object.keys(data).length:target[key],ownKeys:()=>Object.keys(data),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});
  window.cardStorage=storage;
  function download(snapshot,name='单词卡-账号备份'){
    const blob=new Blob([JSON.stringify({app:'jpcard',version:1,exported:new Date().toISOString(),data:snapshot})],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function preserve(snapshot,label){
    const key=`wordcards-recovery:${user.id}:${Date.now()}:${label}`;
    try{localStorage.setItem(key,JSON.stringify({data:snapshot,account:user.email,time:Date.now()}))}
    catch{download(snapshot,'单词卡-'+label+'-恢复副本')}
  }
  async function api(path,body){
    const {data:sessionData,error}=await client.auth.getSession();
    if(error||!sessionData.session||sessionData.session.user.id!==user?.id||frozen)throw Error('登录已失效，请重新登录。未同步的数据仍保留在本机。');
    // 固定本次请求的用户令牌，避免另一标签页换号时把旧数据写入新账号。
    const token=sessionData.session.access_token;
    const response=await fetch(cfg.url.replace(/\/$/,'')+'/rest/v1/'+path,{
      method:body?'POST':'GET',headers:{apikey:cfg.key,Authorization:'Bearer '+token,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw Error(response.status===401?'登录已过期，请重新登录。':response.status===404?'云端数据表尚未初始化。':'云端暂时无法同步，请稍后重试。');
    return result;
  }
  async function readCloud(){const rows=await api('wordcard_accounts?select=data,revision');return rows[0]||{data:{},revision:0}}
  function conflict(remote){remoteConflict=remote;status('另一设备有更新，请选择版本',true);if(!$('syncConflict').open)$('syncConflict').showModal()}
  async function flush(){
    clearTimeout(timer);if(!user||frozen||remoteConflict||!dirty)return !dirty;
    if(inflight)return inflight;
    inflight=(async()=>{
      status('正在同步…');
      const sent=clone(data),expected=revision;
      try{
        const result=await api('rpc/save_wordcards',{expected_revision:expected,payload:sent});
        if(result.conflict){conflict(result);return false}
        revision=result.revision;dirty=JSON.stringify(sent)!==JSON.stringify(data);persist();
        status(dirty?'等待同步…':'已同步');return !dirty;
      }catch(e){status(navigator.onLine?e.message:'离线，修改已留在本机，联网后重试',true);return false}
      finally{inflight=null;if(dirty&&!remoteConflict&&!frozen)timer=setTimeout(flush,5000)}
    })();
    return inflight;
  }
  async function pollCloud(){
    if(!user||frozen||remoteConflict||inflight||document.hidden)return;
    if(dirty){flush();return}
    try{const remote=await readCloud();if(remote.revision!==revision){
      if(dirty){conflict(remote);return}
      status('其他设备有更新，点「加载更新」');$('cloudReload').hidden=false;
    }}catch{status('暂时无法连接，稍后自动重试',true)}
  }
  async function loadApp(){
    if(started)return;started=true;
    window.WORDCARD_DB='yuki-wordcards-'+(user?user.id:'guest');
    $('accountGate').hidden=true;$('wordcardApp').hidden=false;
    $('accountEmail').textContent=user?user.email:'本机模式';
    $('accountManage').title=$('accountManage').ariaLabel=user?'账号与同步':'登录 / 注册';status(user?(dirty?'等待同步…':'已同步'):'数据只保存在此浏览器');
    await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='./account/app.js';s.onload=resolve;s.onerror=reject;document.body.appendChild(s)});
    if(user){poll=setInterval(pollCloud,15000);if(dirty&&!remoteConflict)timer=setTimeout(flush,900)}
  }
  async function startSession(next){
    if(starting||started)return;starting=true;user=next;
    try{
      cacheKey=`wordcards-cache:${user.id}:${tabId}`;
      const remote=await readCloud();
      let cached;try{cached=JSON.parse(localStorage.getItem(cacheKey)||'null')}catch{}
      if(cached?.userId===user.id&&cached.dirty&&validData(cached.data)){
        data=cached.data;revision=cached.revision;dirty=true;
        if(revision!==remote.revision)remoteConflict=remote;
      }else{data=clone(remote.data);revision=remote.revision;dirty=false}
      persist();await loadApp();if(remoteConflict)conflict(remoteConflict);
    }catch(e){authMessage(e.message||'无法读取账号数据，请重试。',true);user=null}
    finally{starting=false}
  }
  function setMode(next){
    mode=next;
    $('authTitle').textContent={login:'欢迎回来',register:'建立你的单词库',reset:'找回密码',password:'设置新密码'}[mode];
    if($('authSwitchHint'))$('authSwitchHint').textContent=mode==='login'?'第一次来这里？':'已经有账号了？';
    const subtitle=document.querySelector?.('.account-gate .sub');
    if(subtitle)subtitle.textContent={login:'登录账号，接着上次的进度学。',register:'从今天开始，把每一份进步留住。',reset:'我们会给你发送一封密码重置邮件。',password:'设置一个至少 8 位的密码，继续学习。'}[mode];
    $('authSubmit').textContent={login:'登录',register:'注册账号',reset:'发送重置邮件',password:'保存新密码'}[mode];
    $('authSwitch').textContent=mode==='login'?'注册账号':'返回登录';
    $('passwordField').hidden=mode==='reset';$('authPassword').required=mode!=='reset';
    $('authPassword').minLength=['register','password'].includes(mode)?8:1;
    $('authPassword').autocomplete=mode==='login'?'current-password':'new-password';
    $('authPassword').placeholder=['register','password'].includes(mode)?'至少 8 位密码':'输入你的密码';
    $('authEmail').disabled=mode==='password';$('authEmail').required=mode!=='password';
    $('authForgot').hidden=mode!=='login';authMessage('');
    $('authResend').hidden=true;
  }
  const authError=e=>{
    const message=e?.message||'';
    if(/Invalid login/i.test(message))return '邮箱或密码不正确。';
    if(/Email not confirmed/i.test(message)){$('authResend').hidden=false;return '请先点击邮件中的确认链接，再登录。'}
    if(/email.*not authorized|error sending|smtp/i.test(message))return '验证邮件暂时发送失败，请稍后重试或联系网站管理员检查发信配置。';
    if(/rate limit|too many/i.test(message))return '请求较频繁，请稍后再试。';
    if(/already registered/i.test(message))return '此邮箱已注册，请直接登录。';
    if(/password/i.test(message))return '密码不符合要求，请使用至少 8 位的新密码。';
    return '操作未完成，请检查网络，或稍后重试。';
  };
  $('authSwitch').onclick=()=>{if(started&&user){$('accountGate').hidden=true;$('wordcardApp').hidden=false;return}setMode(mode==='login'?'register':'login')};
  $('authForgot').onclick=()=>setMode('reset');
  $('authResend').onclick=async()=>{
    if(!client||!$('authEmail').reportValidity())return;
    $('authResend').disabled=true;
    try{const {error}=await client.auth.resend({type:'signup',email:$('authEmail').value.trim(),options:{emailRedirectTo:redirect}});if(error)throw error;authMessage('已请求重新发送验证邮件，请查看收件箱和垃圾邮件。')}
    catch(e){authMessage(authError(e),true)}finally{$('authResend').disabled=false}
  };
  $('guestEnter').onclick=async()=>{user=null;data=readGuest();await loadApp()};
  $('authForm').onsubmit=async e=>{
    e.preventDefault();if(!client){authMessage('云端尚未连接，暂时不能注册或登录。',true);return}
    const button=$('authSubmit');button.disabled=true;authMessage('处理中…');
    const email=$('authEmail').value.trim(),password=$('authPassword').value;
    try{
      if(mode==='reset'){
        const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:redirect});if(error)throw error;
        authMessage('若该邮箱可接收重置邮件，你将收到链接。请查看收件箱和垃圾邮件。');return;
      }
      if(mode==='password'){
        const {error}=await client.auth.updateUser({password});if(error)throw error;
        $('authPassword').value='';recovery=false;location.reload();return;
      }
      const result=mode==='register'?await client.auth.signUp({email,password,options:{emailRedirectTo:redirect}}):await client.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;$('authPassword').value='';
      if(result.data.session)await startSession(result.data.session.user);
      else {authMessage('请查看邮箱中的确认邮件，完成验证后再登录。');$('authResend').hidden=false}
    }catch(e){authMessage(authError(e),true)}finally{button.disabled=false}
  };
  $('accountManage').onclick=()=>{
    if(!user){sessionStorage.removeItem('wordcards-guest');location.reload();return}
    $('accountDetails').textContent=`当前账号：${user.email}`;$('accountToolsStatus').textContent='';$('accountTools').showModal();
  };
  $('closeAccountTools').onclick=()=>$('accountTools').close();
  $('syncNow').onclick=async()=>{await flush();if(!dirty)await pollCloud();$('accountToolsStatus').textContent=$('syncStatus').textContent};
  $('cloudReload').onclick=async()=>{
    if(dirty){await flush();if(dirty)return}
    frozen=true;location.reload();
  };
  $('conflictBackup').onclick=()=>download(data);
  $('syncConflict').addEventListener('cancel',e=>e.preventDefault());
  $('conflictRemote').onclick=()=>{
    if(!remoteConflict)return;preserve(data,'本机');preserve(remoteConflict.data,'云端');
    data=clone(remoteConflict.data);revision=remoteConflict.revision;dirty=false;persist();frozen=true;location.reload();
  };
  $('conflictLocal').onclick=async()=>{
    if(!remoteConflict)return;
    if(!confirm('使用这台设备的数据替换云端版本？两份恢复副本会先保存在此浏览器。'))return;
    preserve(data,'本机');preserve(remoteConflict.data,'云端');revision=remoteConflict.revision;remoteConflict=null;dirty=true;persist();$('syncConflict').close();await flush();
  };
  $('migrateGuest').onclick=async()=>{
    const old=readGuest();
    if(!Object.keys(old).length){$('accountToolsStatus').textContent='这个浏览器没有旧版本记录，可使用「记录 → 导入备份」。';return}
    if(!confirm(`把此浏览器的旧记录导入 ${user.email}？将替换当前账号数据，原账号数据会先留存恢复副本。`))return;
    if(dirty&&!await flush()){$('accountToolsStatus').textContent='请先同步现有修改或处理版本冲突，再导入旧记录。';return}
    preserve(data,'迁移前');data=old;dirty=true;persist();
    frozen=true;location.reload();
  };
  $('accountLogout').onclick=async()=>{
    if(dirty&&!await flush()){$('accountToolsStatus').textContent='还有未同步的修改，请先完成同步或处理冲突后再退出。';return}
    frozen=true;
    const {error}=await client.auth.signOut({scope:'local'});
    if(error){frozen=false;$('accountToolsStatus').textContent='退出失败，请重试。';return}
    location.reload();
  };
  $('changePassword').onclick=()=>{
    $('accountTools').close();$('wordcardApp').hidden=true;$('accountGate').hidden=false;$('authEmail').value=user.email;setMode('password');
  };
  let recoveryCopies=[];
  $('recoverLocal').onclick=()=>{
    recoveryCopies=[];
    for(const key of Object.keys(localStorage)){
      if(!key.startsWith(`wordcards-recovery:${user.id}:`)&&!key.startsWith(`wordcards-cache:${user.id}:`))continue;
      try{const copy=JSON.parse(localStorage.getItem(key));if(validData(copy.data)&&(copy.dirty||key.startsWith('wordcards-recovery:')))recoveryCopies.push({...copy,key})}catch{}
    }
    recoveryCopies.sort((a,b)=>b.time-a.time);
    if(!recoveryCopies.length){$('accountToolsStatus').textContent='当前账号没有未同步数据或恢复副本。';return}
    $('recoveryChoice').replaceChildren(...recoveryCopies.map((copy,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=new Date(copy.time).toLocaleString()+(copy.dirty?' · 未同步':' · 恢复副本');return option}));
    $('localRecovery').showModal();
  };
  $('recoveryExport').onclick=()=>{const copy=recoveryCopies[+$('recoveryChoice').value];if(copy)download(copy.data,'单词卡-恢复副本')};
  $('recoveryRestore').onclick=async()=>{
    const copy=recoveryCopies[+$('recoveryChoice').value];if(!copy)return;
    if(!confirm('用所选副本替换当前账号数据？当前数据也会保留一份恢复副本。'))return;
    if(dirty&&!await flush())return;
    preserve(data,'恢复前');data=clone(copy.data);dirty=true;persist();frozen=true;location.reload();
  };
  $('recoveryClose').onclick=()=>$('localRecovery').close();
  window.addEventListener('online',()=>{flush();pollCloud()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)queueMicrotask(()=>{persist();flush()});else pollCloud()});
  window.addEventListener('beforeunload',e=>{if(user&&dirty&&!frozen){persist();e.preventDefault();e.returnValue=''}});
  if(!configured){$('cloudSetup').hidden=false;return}
  function showCallbackError(){
    authMessage(callbackError==='otp_expired'?'验证链接已失效或已使用。如果已完成邮箱验证，请直接登录；若仍提示邮箱未验证，可重新发送验证邮件。':'邮箱链接未能完成验证。请尝试登录，或重新发送验证邮件。',true);
    $('authResend').hidden=false;
  }
  try{
    if(!/^https:\/\//.test(cfg.url)||cfg.key.startsWith('sb_secret_'))throw Error('云端配置不正确，请使用公开的项目地址和 Publishable key。');
    client=window.Supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY'){recovery=true;setMode('password');$('authEmail').value=session?.user?.email||''}
      if(started&&user&&(event==='SIGNED_OUT'||session&&session.user.id!==user.id)){
        frozen=true;persist();$('wordcardApp').hidden=true;location.reload();
      }
    });
    (async()=>{
      const {data:sessionData,error}=await client.auth.getSession();if(error)throw error;
      if(sessionData.session&&!recovery){const {data:verified,error}=await client.auth.getUser();if(error)throw error;await startSession(verified.user)}
      else if(callbackError)showCallbackError();
    })().catch(()=>{if(callbackError)showCallbackError();else authMessage('无法恢复登录，请检查网络后重试。',true)});
  }catch(e){authMessage(e.message,true)}
})();
