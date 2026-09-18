'use strict';
const $=id=>document.getElementById(id),R=window.RailSim;
const escapeHTML=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={quote:'计算报价',validate:'校验选座',recommend:'推荐席位',lock:'申请锁票',pay:'模拟支付',confirm:'确认并出票',release:'释放锁票',advance:'推进时间 / 到期任务',refund:'补偿退款',reconcile:'核查出票结果',buyPass:'购买计次权益',getOrder:'查询渠道订单',deliver:'投递余票事件',rebuild:'重建余票投影'};
const routes={quote:['trade','price'],validate:['core','seat'],recommend:['core','seat'],lock:['trade','core'],pay:['trade'],confirm:['trade','core'],release:['trade','core'],advance:['core'],refund:['trade'],reconcile:['trade','core'],buyPass:['trade','price','core'],getOrder:['channel','trade'],deliver:['core'],rebuild:['core']};
const names={trade:'销售交易',price:'产品与价格',seat:'席位与选座',core:'核心票务',channel:'开放 API / 渠道'};
const states={QUOTED:'已报价',HELD:'已锁定',PAID:'已支付',FULFILLED:'已交付',RESULT_UNKNOWN:'结果未知',CANCELLED:'已取消',REFUND_REQUIRED:'待补偿退款',REFUNDED:'已退款',SOLD:'已售',RELEASED:'已释放',EXPIRED:'已到期',VALID:'有效'};
const sample={quote:{order:'M1',channel:'SELF',from:0,to:2,units:1},validate:{order:'M1',seats:['S1'],group:'X'},recommend:{order:'M1',group:'X',family:false},lock:{order:'M1',requestId:'ML1'},pay:{order:'M1'},confirm:{order:'M1',drop:false},release:{order:'M1'},advance:{minutes:11},refund:{order:'M1'},reconcile:{order:'M1'},buyPass:{order:'MP1',owner:'U1'},getOrder:{order:'M1',caller:'SELF'},deliver:{version:1},rebuild:{}};
let config=R.copy(R.profiles.A),sim,batchReports=[],selectedLog=-1,selectedSeat=null,timer=null,toastTimer;
function toast(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function bugs(){return Object.fromEntries(['skipVersion','skipQuota','skipIdempotency'].map(k=>[k,$(k).checked]));}
function stop(){clearInterval(timer);timer=null;$('auto').textContent='自动播放';}
function reset(){stop();sim=new R.Simulator(config,bugs());sim.load($('scenario').value);selectedLog=-1;selectedSeat=null;render();}
function setTab(tab){document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));['state','messages','results','contracts'].forEach(t=>$('panel-'+t).hidden=t!==tab);}
function next(){const row=sim.next();if(row)selectedLog=sim.logs.length-1;if(sim.cursor===sim.queue.length)stop();render();}
function table(headers,rows){return rows.length?'<table><thead><tr>'+headers.map(h=>'<th>'+escapeHTML(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+escapeHTML(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'<div class="empty">暂无记录 · 运行步骤后更新</div>';}
const range=h=>['A','B','C'][h.from]+' → '+['A','B','C'][h.to];
const money=n=>(n??0).toFixed(2)+' SIM';
function render(){
 const s=sim.s,c=sim.c,last=sim.logs.at(-1),done=sim.cursor>=sim.queue.length;
 $('goal').textContent=sim.scenario?.goal||'自由发送模拟接口，观察真实结果。预设场景的验收标准不适用于自由实验。';
 $('overrides').textContent=sim.scenario?.setup?'场景固定条件：'+JSON.stringify(sim.scenario.setup):'';
 $('clock').textContent='T + '+s.time+' 分钟';$('version').textContent='库存版本 v'+s.version;
 $('progress').max=Math.max(sim.queue.length,1);$('progress').value=sim.cursor;
 $('progressLabel').textContent=sim.scenario?sim.cursor+' / '+sim.queue.length+' 步'+(done?' · 已执行完毕':''):'自由实验 · '+sim.logs.length+' 次操作';
 $('step').disabled=done;$('finish').disabled=done;$('auto').disabled=done;
 $('currentTitle').textContent=last?'#'+last.seq+' '+labels[last.action]:'准备就绪';
 $('currentRoute').textContent=last?routes[last.action].map(k=>names[k]).join(' → ')+' ｜ '+(last.result.message|| (last.result.replayed?'返回已存在结果，未重复执行':'操作完成；点击“接口消息”查看状态差异')):'点击“执行下一步”，观察每一次状态变化。';
 const badge=$('currentStatus');badge.textContent=last?(last.matched?(last.result.code==='OK'?'符合预期':'预期拒绝 / 未知结果'):'与预期不符'):'尚未执行';badge.className='badge '+(last?(last.matched?'good':'bad'):'');
 document.querySelectorAll('[data-module]').forEach(n=>n.classList.toggle('active',!!last&&routes[last.action].includes(n.dataset.module)));
 const [from,to]=$('viewRange').value.split(',').map(Number),rr={from,to};
 $('seatMap').innerHTML=s.resources.map(r=>{const hs=s.holds.filter(h=>['HELD','SOLD'].includes(h.state)&&h.seats.includes(r.id)&&h.from<to&&from<h.to);const status=hs.some(h=>h.state==='SOLD')?'sold':hs.length?'held':'';return '<button data-seat="'+r.id+'" class="'+status+' '+(r.kind==='BERTH'?'berth ':'')+(selectedSeat===r.id?'selected':'')+'" aria-label="'+r.id+' '+(status==='sold'?'已售':status?'锁定':'可用')+'"><strong>'+(status==='sold'?'●':status?'◷':'○')+' '+r.id+'</strong><small>'+escapeHTML(r.position)+' · '+(r.level==='PREMIUM'?'高级':'标准')+'</small></button>';}).join('');
 $('seatMap').querySelectorAll('[data-seat]').forEach(b=>b.onclick=()=>{selectedSeat=b.dataset.seat;render();});
 if(selectedSeat){const hs=s.holds.filter(h=>h.seats.includes(selectedSeat));$('seatDetail').textContent=selectedSeat+'：'+(hs.map(h=>range(h)+' '+states[h.state]+' / '+h.order).join('；')||'当前没有占用记录');}else $('seatDetail').textContent='点击资源查看该席位在各区间的占用。每两个连续编号为一排或一个包厢。';
 const held=s.resources.filter(r=>s.holds.some(h=>h.state==='HELD'&&h.seats.includes(r.id)&&h.from<to&&from<h.to)).length;
 $('inventoryStats').innerHTML='<div>定义容量<strong>'+s.resources.length+'</strong></div><div>区间可用<strong>'+sim.countAvailable(rr)+'</strong></div><div>临时锁定<strong>'+held+'</strong></div>';
 $('entitlement').innerHTML=s.pass?'<div class="mini-row"><span>'+s.pass.id+' · '+s.pass.owner+'</span><strong>可用 '+(s.pass.total-s.pass.used-s.pass.frozen)+' 次</strong></div><div class="mini-row"><span>总量 '+s.pass.total+' / 冻结 '+s.pass.frozen+' / 已用 '+s.pass.used+'</span><span>确认出票扣次</span></div>':'<div class="empty">尚未签发乘车权益</div>';
 $('quotas').innerHTML=['SELF','OTA'].map(ch=>{const use=Math.max(...Array.from({length:to-from},(_,i)=>s.holds.filter(h=>['HELD','SOLD'].includes(h.state)&&h.channel===ch&&h.from<=from+i&&h.to>from+i).reduce((n,h)=>n+h.seats.length,0)));return '<div class="mini-row"><span>'+ch+' 渠道占用（区间峰值）</span><strong>'+use+' / '+c.channelLimit+'</strong></div>';}).join('')+'<div class="mini-row"><span>优惠配额上限（每基础区间）</span><strong>'+c.discountLimit+'</strong></div>';
 $('projection').innerHTML='<div class="mini-row"><span>A → C 查询可用 '+s.projection.available+' / 权威可用 '+sim.countAvailable()+'</span><strong>v'+s.projection.version+' '+(s.projection.version<s.version?'待刷新':'已同步')+'</strong></div>';
 $('orders').innerHTML=table(['订单','渠道','产品 / 区间','金额','支付','交易状态','锁票'],Object.values(s.orders).map(o=>[o.id,o.channel,o.product==='PASS'?'计次票':range(o),money(o.amount),o.paid?'已支付':'未支付',states[o.status]||o.status,o.holdId||'—']));
 $('quotes').innerHTML=table(['报价','金额','有效至','规则','依据版本'],Object.values(s.quotes).map(q=>[q.id,money(q.amount),'T+'+q.expires,q.ruleVersion,'v'+q.sourceVersion]));
 $('funds').innerHTML=table(['操作','订单','金额'],s.payments.map(p=>[p.kind==='PAY'?'收款':'退款',p.order,money(p.amount)]))+'<h3>票证</h3>'+table(['标识','订单','资源'],s.tickets.map(t=>[t.id,t.order,t.seats.join(', ')]));
 $('holds').innerHTML=table(['占用','订单','资源','区间','状态','到期','权益'],s.holds.map(h=>[h.id,h.order,h.seats.join(', '),range(h),states[h.state],'T+'+h.expires,h.usePass?'使用 '+h.units+' 次':'—']));
 $('logCount').textContent=sim.logs.length;
 $('trace').innerHTML=sim.logs.length?sim.logs.map((l,i)=>'<button class="trace-row '+(i===selectedLog?'active':'')+'" data-log="'+i+'"><span class="top"><strong>#'+l.seq+' '+labels[l.action]+'</strong><span class="'+(l.matched?'good-text':'bad-text')+'">'+(l.matched?'✓':'!')+' '+escapeHTML(l.result.code)+'</span></span><small>'+routes[l.action].map(k=>names[k]).join(' → ')+'</small></button>').join(''):'<div class="empty">执行步骤后显示真实请求与响应</div>';
 $('trace').querySelectorAll('[data-log]').forEach(b=>b.onclick=()=>{selectedLog=Number(b.dataset.log);render();});
 const log=sim.logs[selectedLog];$('inspector').textContent=log?JSON.stringify({step:log.seq,route:routes[log.action].map(k=>names[k]),operation:log.action,request:log.request,expected:log.expected,response:log.result,stateChanges:log.delta},null,2):'尚未选择消息';
 const report=sim.report();let title=!sim.scenario?'自由实验：查看下方不变量':!done?'执行中：完成全部步骤后判定':report.passed?'通过：实际结果符合场景预期':'未通过：发现状态或接口结果偏差';
 $('verdict').innerHTML='<strong class="'+(done&&sim.scenario&&!report.passed?'bad-text':'good-text')+'">'+title+'</strong><p class="hint">当前状态检查与每一步历史检查同时参与验收；终态正确不能掩盖中间过程的违规。</p>';
 $('checks').innerHTML=report.checks.map(ch=>'<div class="check-result '+(ch.ok?'':'bad')+'">'+(ch.ok?'✓ ':'✕ ')+ch.name+'</div>').join('');
 $('assertions').innerHTML=report.assertions.map(a=>'<div class="assertion '+(a.ok?'good-text':'bad-text')+'">'+(a.ok?'✓ ':'✕ ')+escapeHTML(a.name)+'</div>').join('')||'<p class="hint">尚未执行</p>';
}
function renderBatch(){if(!batchReports.length)return;const passed=batchReports.filter(r=>r.passed).length;$('batchSummary').textContent=passed+' / '+batchReports.length+' 通过 · 当前市场 / 当前故障开关';$('batchResults').innerHTML='<p><strong>'+passed+' / '+batchReports.length+' 场景通过</strong> <span class="hint">每个场景独立初始化。带固定条件的场景会覆盖对应配置项。</span></p>'+table(['场景','结果','诊断'],batchReports.map(r=>[r.scenario,r.passed?'通过':'未通过',r.passed?'符合全部断言':r.checks.filter(c=>!c.ok).map(c=>c.name).concat(r.assertions.filter(a=>!a.ok).map(a=>a.name)).join('；')||'历史不变量或终态不符']));}
$('market').innerHTML=Object.entries(R.profiles).map(([k,c])=>'<option value="'+k+'">'+c.name+'</option>').join('');
$('scenario').innerHTML=R.scenarios.map(s=>'<option value="'+s.id+'">'+s.name+'</option>').join('');
$('operation').innerHTML=Object.keys(labels).map(k=>'<option value="'+k+'">'+labels[k]+' · '+k+'</option>').join('');
$('operation').onchange=()=>{$('request').value=JSON.stringify(sample[$('operation').value],null,2);};$('operation').onchange();
$('config').value=JSON.stringify(config,null,2);
$('market').onchange=()=>{config=R.copy(R.profiles[$('market').value]);$('config').value=JSON.stringify(config,null,2);batchReports=[];$('batchSummary').textContent='';$('batchResults').textContent='配置已变更，请重新批量验证。';reset();};
$('scenario').onchange=reset;$('reset').onclick=reset;$('step').onclick=next;
$('auto').onclick=()=>{if(timer){stop();return;} $('auto').textContent='暂停';timer=setInterval(next,800);};
$('finish').onclick=()=>{stop();sim.runAll();selectedLog=sim.logs.length-1;render();setTab('results');};
$('batch').onclick=()=>{stop();batchReports=R.batch(config,bugs());renderBatch();setTab('results');};
for(const k of ['skipVersion','skipQuota','skipIdempotency'])$(k).onchange=()=>{batchReports=[];$('batchSummary').textContent='';$('batchResults').textContent='故障开关已变化，请重新批量验证。';reset();};
$('applyConfig').onclick=()=>{try{config=R.validateConfig(JSON.parse($('config').value));reset();batchReports=[];$('batchSummary').textContent='';$('batchResults').textContent='配置已变更，请重新批量验证。';toast('市场配置已应用。');}catch(e){toast(e.message);}};
$('viewRange').onchange=render;document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
$('help').onclick=()=>{setTab('contracts');$('panel-contracts').scrollIntoView({behavior:'smooth',block:'start'});};
$('send').onclick=()=>{try{const p=JSON.parse($('request').value);if(!p||typeof p!=='object'||Array.isArray(p))throw Error('请求必须是 JSON 对象');stop();sim.scenario=null;sim.queue=[];sim.cursor=0;sim.step($('operation').value,p);selectedLog=sim.logs.length-1;render();setTab('messages');}catch(e){toast('请求未执行：'+e.message);}};
$('clearManual').onclick=()=>{stop();sim=new R.Simulator(config,bugs());selectedLog=-1;render();toast('账本已清空，可以从 quote 或 buyPass 开始。');};
$('export').onclick=()=>{const data={model:'Rail Lab 1.0',exportedAt:new Date().toISOString(),scope:'内存离散状态模型；不验证真实数据库原子性或外部供应商',current:sim.report(),batch:batchReports};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='rail-simulation-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);};
$('contractTable').innerHTML=table(['接口','调用关系','返回承诺'],Object.keys(labels).map(k=>[k,routes[k].map(x=>names[x]).join(' → '),{quote:'有效期内保证价格，不保证资源',validate:'基于指定占用版本的规则结论',recommend:'返回候选组合，不占库存',lock:'在原子提交假设下建立资源与权益占用',confirm:'确认已售并签发唯一票证',pay:'只修改模拟资金记录',release:'幂等释放资源与权益冻结',advance:'推进逻辑时间并执行到期释放',reconcile:'读取核心事实恢复交易状态',buyPass:'支付后签发权益，不占座',getOrder:'按渠道归属授权',deliver:'投递带版本的完整余票快照',rebuild:'从当前权威库存生成投影',refund:'资源已释放后补偿退款'}[k]]));
reset();window.railLab={get sim(){return sim;},get batchReports(){return batchReports;},setTab};
