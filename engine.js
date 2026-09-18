(function(root){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
const profiles={
 A:{name:'市场 A · 座席与固定票价',layout:'seat',count:8,basePrice:100,dynamic:false,threshold:.5,multiplier:1.5,selection:'standard',channelLimit:2,discountLimit:1,holdTTL:10,quoteTTL:6,passUses:10},
 B:{name:'市场 B · 卧铺与浮动票价',layout:'berth',count:8,basePrice:150,dynamic:true,threshold:.25,multiplier:1.4,selection:'neighbor',channelLimit:2,discountLimit:1,holdTTL:10,quoteTTL:6,passUses:10},
 C:{name:'市场 C · 混合等级与家庭偏好',layout:'mixed',count:8,basePrice:120,dynamic:true,threshold:.5,multiplier:1.3,selection:'family',channelLimit:3,discountLimit:1,holdTTL:10,quoteTTL:6,passUses:20}
};
function validateConfig(c){
 if(!c||typeof c!=='object')throw Error('配置必须是对象');
 if(typeof c.name!=='string'||c.name.length>100)throw Error('name 必须是长度不超过 100 的文本');
 for(const k of ['count','channelLimit','discountLimit','holdTTL','quoteTTL','passUses'])if(!Number.isInteger(c[k])||c[k]<(k==='discountLimit'?0:1)||c[k]>100)throw Error(k+' 必须是有效整数（上限 100）');
 if(c.count<4||c.count>16)throw Error('资源数量支持 4–16');
 if(!['seat','berth','mixed'].includes(c.layout)||!['standard','neighbor','family'].includes(c.selection))throw Error('布局或选座策略不受支持');
 if(typeof c.dynamic!=='boolean'||!Number.isFinite(c.basePrice)||c.basePrice<=0||c.basePrice>100000||!Number.isFinite(c.threshold)||c.threshold<0||c.threshold>1||!Number.isFinite(c.multiplier)||c.multiplier<1||c.multiplier>10)throw Error('价格参数不合法');
 return copy(c);
}
const overlap=(a,b)=>a.from<b.to&&b.from<a.to;
const active=h=>['HELD','SOLD'].includes(h.state);
const scenarios=[
 {id:'normal',name:'01 正常购票',goal:'报价 → 规则校验 → 锁票 → 支付 → 确认出票',steps:[['quote',{order:'O1'}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L1'}],['pay',{order:'O1'}],['confirm',{order:'O1'}]],verify:s=>s.tickets.length===1&&s.orders.O1?.status==='FULFILLED'},
 {id:'duplicate',name:'02 重复锁票与出票',goal:'相同幂等键重试，始终只保留一次占用、一次收款和一张票',steps:[['quote',{order:'O1'}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L1'}],['lock',{order:'O1',requestId:'L1'}],['pay',{order:'O1'}],['pay',{order:'O1'}],['confirm',{order:'O1'}],['confirm',{order:'O1'}]],verify:s=>s.holds.length===1&&s.tickets.length===1&&s.payments.filter(p=>p.kind==='PAY').length===1},
 {id:'race',name:'03 双渠道抢同一席位',goal:'将两个请求交错执行，只有一个渠道能占用 A—C 的 S1',steps:[['quote',{order:'O1',channel:'SELF'}],['quote',{order:'O2',channel:'OTA'}],['validate',{order:'O1',seats:['S1']}],['validate',{order:'O2',seats:['S1']}],['lock',{order:'O1',requestId:'L1'}],['lock',{order:'O2',requestId:'L2'},'STATE_CHANGED'],['validate',{order:'O2',seats:['S1']},'UNAVAILABLE']],verify:s=>s.holds.filter(active).length===1},
 {id:'rule',name:'04 规则校验后状态变化',goal:'演示相邻属性组限制；判断依赖整个车厢版本，过期判断必须失效。示例规则不代表实际国家政策。',setup:{selection:'neighbor'},steps:[['quote',{order:'O1'}],['quote',{order:'O2'}],['validate',{order:'O1',seats:['S1'],group:'X'}],['validate',{order:'O2',seats:['S2'],group:'Y'}],['lock',{order:'O1',requestId:'L1'}],['lock',{order:'O2',requestId:'L2'},'STATE_CHANGED'],['validate',{order:'O2',seats:['S2'],group:'Y'},'NEIGHBOR_RULE']],verify:s=>s.holds.filter(active).length===1},
 {id:'quota',name:'05 最后一个优惠配额',goal:'两个报价都可生成，但资源与优惠配额必须一并校验和占用',setup:{discountLimit:1},steps:[['quote',{order:'O1',discount:true}],['quote',{order:'O2',discount:true}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L1'}],['validate',{order:'O2',seats:['S3']}],['lock',{order:'O2',requestId:'L2'},'DISCOUNT_EXHAUSTED']],verify:s=>s.holds.filter(h=>active(h)&&h.discount).length===1},
 {id:'quoteExpiry',name:'06 报价过期再核价',goal:'过期报价不能用于建立锁票；重新报价后重试可成功',steps:[['quote',{order:'O1'}],['validate',{order:'O1',seats:['S1']}],['advance',{minutes:101}],['lock',{order:'O1',requestId:'L1'},'QUOTE_EXPIRED'],['quote',{order:'O1'}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L2'}]],verify:s=>s.holds.filter(active).length===1},
 {id:'timeout',name:'07 已出票但响应丢失',goal:'核心成功、交易侧结果未知；查询真实状态恢复，而不是再次收款或出票',steps:[['quote',{order:'O1'}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L1'}],['pay',{order:'O1'}],['confirm',{order:'O1',drop:true},'RESULT_UNKNOWN'],['reconcile',{order:'O1'}],['confirm',{order:'O1'}]],verify:s=>s.orders.O1?.status==='FULFILLED'&&s.tickets.length===1&&s.payments.length===1},
 {id:'expiry',name:'08 支付后锁票到期',goal:'将到期操作排在确认前；拒绝过期出票，由交易系统退款恢复',steps:[['quote',{order:'O1'}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L1'}],['pay',{order:'O1'}],['advance',{minutes:101}],['confirm',{order:'O1'},'HOLD_EXPIRED'],['refund',{order:'O1'}]],verify:s=>s.holds.every(h=>!active(h))&&s.tickets.length===0&&s.orders.O1?.status==='REFUNDED'},
 {id:'pass',name:'09 计次票购买与使用',goal:'购买权益无需占座；使用时一起冻结次数和席位，确认一次使用只扣一次',steps:[['buyPass',{order:'P1',owner:'U1'}],['quote',{order:'O1',entitlement:true}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L1',usePass:true}],['confirm',{order:'O1'}],['confirm',{order:'O1'}]],verify:s=>s.pass&&s.pass.used===1&&s.pass.frozen===0&&s.tickets.length===1},
 {id:'passCancel',name:'10 取消预约恢复次数',goal:'幂等释放同时恢复权益冻结；不增加最初的权益总量',steps:[['buyPass',{order:'P1',owner:'U1'}],['quote',{order:'O1',entitlement:true}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L1',usePass:true}],['release',{order:'O1'}],['release',{order:'O1'}]],verify:s=>s.pass&&s.pass.frozen===0&&s.pass.used===0&&s.holds.every(h=>!active(h))},
 {id:'segments',name:'11 同座不同区间复用',goal:'S1 的 A—B 和 B—C 可以分别占用；A—C 无法再占用',steps:[['quote',{order:'O1',from:0,to:1}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L1'}],['quote',{order:'O2',from:1,to:2}],['validate',{order:'O2',seats:['S1']}],['lock',{order:'O2',requestId:'L2'}],['quote',{order:'O3'}],['validate',{order:'O3',seats:['S1']},'UNAVAILABLE']],verify:s=>s.holds.filter(active).length===2},
 {id:'channel',name:'12 渠道额度与订单归属',goal:'验证库存类渠道上限，以及 API 身份校验后仍需执行订单归属校验',setup:{channelLimit:1},steps:[['quote',{order:'O1',channel:'OTA'}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L1'}],['quote',{order:'O2',channel:'OTA'}],['validate',{order:'O2',seats:['S3']}],['lock',{order:'O2',requestId:'L2'},'CHANNEL_LIMIT'],['getOrder',{order:'O1',caller:'SELF'},'FORBIDDEN']],verify:s=>s.holds.filter(active).length===1},
 {id:'events',name:'13 余票事件乱序与重建',goal:'模拟版本 2 先于版本 1 到达；旧快照不得覆盖新快照，重建与权威状态一致',steps:[['quote',{order:'O1'}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L1'}],['release',{order:'O1'}],['deliver',{version:2}],['deliver',{version:1},'STALE_EVENT'],['rebuild',{}]],verify:s=>s.projection.version===s.version&&s.projection.available===s.resources.length},
 {id:'pricing',name:'14 动态定价策略',goal:'相同核心销售上下文，固定与浮动策略返回不同报价；替换策略无需改变库存接口',setup:{dynamic:true,threshold:.1,multiplier:2},steps:[['quote',{order:'O1'}],['validate',{order:'O1',seats:['S1']}],['lock',{order:'O1',requestId:'L1'}],['pay',{order:'O1'}],['confirm',{order:'O1'}],['quote',{order:'O2'}]],verify:s=>s.quotes.Q2.amount===s.quotes.Q1.amount*2}
];
class Simulator{
 constructor(config=profiles.A,bugs={}){this.config=validateConfig(config);this.bugs={skipVersion:false,skipQuota:false,skipIdempotency:false,...bugs};this.reset();}
 reset(){const c=this.config;this.s={time:0,version:0,resources:Array.from({length:c.count},(_,i)=>({id:'S'+(i+1),row:Math.floor(i/2),kind:c.layout==='berth'?'BERTH':'SEAT',level:c.layout==='mixed'&&i<2?'PREMIUM':'STANDARD',window:i%2===0,position:c.layout==='berth'?(i%2===0?'下铺':'上铺'):(i%2===0?'靠窗':'过道')})),orders:{},quotes:{},plans:{},holds:[],payments:[],tickets:[],pass:null,events:[],projection:{version:0,available:c.count},idem:{}};this.logs=[];this.assertions=[];this.queue=[];this.cursor=0;this.scenario=null;}
 load(id){const sc=scenarios.find(x=>x.id===id);if(!sc)throw Error('未知场景');this.reset();this.scenario=sc;this.queue=copy(sc.steps);this.effective={...this.config,...sc.setup};}
 get c(){return this.effective||this.config;}
 ok(data={}){return {code:'OK',...data};} fail(code,message){return {code,message};}
 available(seat,range){return !this.s.holds.some(h=>active(h)&&h.seats.includes(seat)&&overlap(h,range));}
 countAvailable(range={from:0,to:2}){return this.s.resources.filter(r=>this.available(r.id,range)).length;}
 emit(type){this.s.version++;this.s.events.push({eventId:'E'+this.s.version,version:this.s.version,type,available:this.countAvailable()});}
 snapshot(){return copy(this.s);}
 lookup(order){const id=typeof order==='string'?order:order.id;return this.s.holds.find(h=>h.id===this.s.orders[id]?.holdId);}
 execute(action,p={}){
 const s=this.s,c=this.c,o=s.orders[p.order];
 if(action==='quote'){
  if(['__proto__','constructor','prototype'].includes(p.order))return this.fail('BAD_REQUEST','保留标识不可用');
  if(o&&o.holdId)return this.fail('ORDER_LOCKED','已建立占用的订单不能覆盖报价');
  const from=p.from??o?.from??0,to=p.to??o?.to??2,channel=p.channel??o?.channel??'SELF';
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to>2||from>=to)return this.fail('BAD_RANGE','区间无效');
  if(!['SELF','OTA'].includes(channel)||!p.order)return this.fail('BAD_REQUEST','渠道或订单标识无效');
  if(o&&o.channel!==channel)return this.fail('CHANNEL_MISMATCH','不能改变订单渠道');
  const entitled=p.entitlement??o?.entitlement??false;
  if(entitled&&(!s.pass||s.pass.owner!=='U1'))return this.fail('NO_ENTITLEMENT','需要先购买 U1 的权益');
  const sold=s.holds.filter(h=>h.state==='SOLD'&&overlap(h,{from,to})).reduce((n,h)=>n+h.seats.length*(Math.min(h.to,to)-Math.max(h.from,from)),0)/(s.resources.length*(to-from));
  const units=p.units??o?.units??1;if(!Number.isInteger(units)||units<1||units>c.count)return this.fail('BAD_REQUEST','人数无效');
  const qid='Q'+(Object.keys(s.quotes).length+1),discount=p.discount??o?.discount??false;
  const amount=entitled?0:Math.round(c.basePrice*(c.dynamic&&sold>=c.threshold?c.multiplier:1)*(to-from)/2*units*(discount?.8:1)*100)/100;
  s.quotes[qid]={id:qid,order:p.order,amount,currency:'SIM',expires:s.time+c.quoteTTL,ruleVersion:c.dynamic?'DYNAMIC-1':'FIXED-1',sourceVersion:s.version,guarantee:'VALID_UNTIL_EXPIRY',discount,entitlement:entitled,from,to,units,channel};
  s.orders[p.order]={id:p.order,channel,from,to,units,discount,entitlement:entitled,quoteId:qid,amount,status:'QUOTED',paid:false,owner:'U1'};delete s.plans[p.order];return this.ok({quote:s.quotes[qid]});
 }
 if(action==='buyPass'){
  if(s.pass)return this.ok({entitlement:s.pass,replayed:true});if(!p.order)return this.fail('BAD_REQUEST','缺少购买订单');
  s.orders[p.order]={id:p.order,channel:'SELF',status:'FULFILLED',product:'PASS',paid:true,amount:c.basePrice*5,owner:p.owner||'U1'};
  s.payments.push({id:'PAY'+(s.payments.length+1),order:p.order,amount:c.basePrice*5,kind:'PAY'});s.pass={id:'ENT-1',owner:p.owner||'U1',total:c.passUses,used:0,frozen:0,validUntil:s.time+43200,productVersion:'PASS-1'};
  return this.ok({entitlement:s.pass});
 }
 if(action==='advance'){
  if(!Number.isFinite(p.minutes)||p.minutes<0)return this.fail('BAD_REQUEST','时间必须非负');s.time+=p.minutes;
  for(const h of s.holds)if(h.state==='HELD'&&h.expires<=s.time)this.endHold(h,'EXPIRED');return this.ok({time:s.time});
 }
 if(action==='deliver'){
  const e=s.events.find(e=>e.version===p.version);if(!e)return this.fail('EVENT_NOT_FOUND','未找到事件');
  if(e.version<=s.projection.version)return this.fail('STALE_EVENT','忽略旧版本完整快照');s.projection={version:e.version,available:e.available};return this.ok({projection:s.projection});
 }
 if(action==='rebuild'){s.projection={version:s.version,available:this.countAvailable()};return this.ok({projection:s.projection});}
 if(!o)return this.fail('ORDER_NOT_FOUND','订单不存在');
 if(action==='getOrder'){if(p.caller!==o.channel)return this.fail('FORBIDDEN','渠道无权查看此订单');return this.ok({order:o});}
 if(action==='validate'||action==='recommend'){
  if(o.holdId)return this.fail('ORDER_LOCKED','订单已占用资源');
  let seats=p.seats;
  if(action==='recommend'){
   const candidates=s.resources.filter(r=>this.available(r.id,o));seats=null;
   for(let i=0;i<candidates.length;i++){
    const ids=candidates.slice(i,i+o.units).map(r=>r.id);if(ids.length===o.units&&this.ruleCheck(ids,o,p).code==='OK'){seats=ids;break;}
   }
   if(!seats)return this.fail('NO_MATCH','没有满足硬约束的候选组合');
  }
  const result=this.ruleCheck(seats,o,p);if(result.code!=='OK')return result;
  s.plans[o.id]={order:o.id,seats:copy(seats),version:s.version,ruleVersion:c.selection+'-1',group:p.group||'X',family:!!p.family};return this.ok({decision:s.plans[o.id]});
 }
 if(action==='lock'){
  const key=o.channel+':'+p.requestId, fingerprint=JSON.stringify({order:o.id,quote:o.quoteId,usePass:!!p.usePass});
  if(!p.requestId)return this.fail('BAD_REQUEST','缺少幂等请求标识');
  if(!this.bugs.skipIdempotency&&s.idem[key])return s.idem[key].fingerprint===fingerprint?{...copy(s.idem[key].result),replayed:true}:this.fail('IDEMPOTENCY_CONFLICT','同一幂等键对应不同请求');
  if(o.holdId&&!this.bugs.skipIdempotency)return this.fail('ORDER_LOCKED','该订单已经有占用');
  const q=s.quotes[o.quoteId],plan=s.plans[o.id];
  if(!q||q.expires<=s.time)return this.fail('QUOTE_EXPIRED','报价已过期，请重新报价');
  if(!plan)return this.fail('NO_DECISION','先执行选座校验');
  if(plan.version!==s.version&&!this.bugs.skipVersion&&!this.bugs.skipIdempotency)return this.fail('STATE_CHANGED','规则依赖的车厢状态已变化，重新校验');
  if(plan.seats.some(id=>this.s.holds.some(h=>active(h)&&h.seats.includes(id)&&overlap(h,o)&&!(this.bugs.skipIdempotency&&h.order===o.id))))return this.fail('UNAVAILABLE','区间资源不可用');
  if(!this.bugs.skipQuota){
   for(let seg=o.from;seg<o.to;seg++){
    const relevant=s.holds.filter(h=>active(h)&&h.from<=seg&&h.to>seg);
    const byChannel=relevant.filter(h=>h.channel===o.channel).reduce((n,h)=>n+h.seats.length,0);
    if(byChannel+plan.seats.length>c.channelLimit)return this.fail('CHANNEL_LIMIT','库存类渠道额度不足');
    const discounts=relevant.filter(h=>h.discount).reduce((n,h)=>n+h.seats.length,0);
    if(q.discount&&discounts+plan.seats.length>c.discountLimit)return this.fail('DISCOUNT_EXHAUSTED','优惠配额不足');
   }
  }
  if(!!p.usePass!==!!o.entitlement)return this.fail('PRODUCT_MISMATCH','权益报价必须配合权益用量占用');
  if(p.usePass&&(!s.pass||s.pass.owner!==o.owner||s.pass.validUntil<=s.time||s.pass.total-s.pass.used-s.pass.frozen<o.units))return this.fail('ENTITLEMENT_INSUFFICIENT','权益次数不足或不适用');
  const h={id:'H'+(s.holds.length+1),order:o.id,channel:o.channel,seats:copy(plan.seats),from:o.from,to:o.to,state:'HELD',expires:s.time+c.holdTTL,discount:q.discount,usePass:!!p.usePass,units:o.units,group:plan.group,ruleVersion:plan.ruleVersion};
  // 本模拟中的事务边界：所有校验在前，下面一次同步提交。真实实现须提供同等原子性。
  s.holds.push(h);if(h.usePass)s.pass.frozen+=h.units;o.holdId=h.id;o.status='HELD';this.emit('RESOURCE_HELD');
  const result=this.ok({hold:copy(h)});s.idem[key]={fingerprint,result:copy(result)};return result;
 }
 if(action==='pay'){
  if(o.paid)return this.ok({replayed:true});const h=this.lookup(o);if(!h||h.state!=='HELD'||h.expires<=s.time)return this.fail('NO_ACTIVE_HOLD','需要有效锁票');
  o.paid=true;o.status='PAID';s.payments.push({id:'PAY'+(s.payments.length+1),order:o.id,amount:o.amount,kind:'PAY'});return this.ok({paid:true,amount:o.amount});
 }
 if(action==='confirm'){
  const h=this.lookup(o);if(!h)return this.fail('NO_ACTIVE_HOLD','没有锁票记录');
  if(h.state==='SOLD')return this.ok({ticket:s.tickets.find(t=>t.hold===h.id),replayed:true});
  if(h.state!=='HELD'||h.expires<=s.time)return this.fail('HOLD_EXPIRED','占用已经释放或到期');
  if(!h.usePass&&!o.paid)return this.fail('PAYMENT_REQUIRED','交易确认条件不满足');
  h.state='SOLD';if(h.usePass){s.pass.frozen-=h.units;s.pass.used+=h.units;}
  const t={id:'T'+(s.tickets.length+1),order:o.id,hold:h.id,seats:h.seats,state:'VALID'};s.tickets.push(t);this.emit('TICKET_ISSUED');
  o.status=p.drop?'RESULT_UNKNOWN':'FULFILLED';return p.drop?this.fail('RESULT_UNKNOWN','已注入响应丢失：请查询核心处理结果'):this.ok({ticket:t});
 }
 if(action==='reconcile'){const h=this.lookup(o);if(h?.state==='SOLD'){o.status='FULFILLED';return this.ok({ticket:s.tickets.find(t=>t.hold===h.id)});}return this.ok({holdState:h?.state||'NONE'});}
 if(action==='release'){
  const h=this.lookup(o);if(!h)return this.fail('NO_ACTIVE_HOLD','没有占用');if(h.state==='SOLD')return this.fail('AFTERSALE_REQUIRED','已售票须走售后流程');
  if(h.state!=='HELD')return this.ok({replayed:true});this.endHold(h,'RELEASED');return this.ok({hold:h});
 }
 if(action==='refund'){
  if(!o.paid)return this.fail('NO_PAYMENT','没有可退款项');if(o.status==='REFUNDED')return this.ok({replayed:true});
  if(active(this.lookup(o)||{}))return this.fail('RESOURCE_ACTIVE','先完成资源取消，本版不模拟已出票退票');
  s.payments.push({id:'REF'+(s.payments.length+1),order:o.id,amount:o.amount,kind:'REFUND'});o.status='REFUNDED';return this.ok({refunded:o.amount});
 }
 return this.fail('UNKNOWN_OPERATION','不支持的操作');
 }
 ruleCheck(seats,o,p){
  if(!Array.isArray(seats)||seats.length!==o.units||new Set(seats).size!==seats.length)return this.fail('BAD_SELECTION','席位数必须等于人数，且不能重复');
  if(seats.some(id=>!this.s.resources.some(r=>r.id===id)))return this.fail('RESOURCE_NOT_FOUND','席位不存在');
  if(seats.some(id=>!this.available(id,o)))return this.fail('UNAVAILABLE','资源在该区间已被占用');
  if(p.family&&new Set(seats.map(id=>this.s.resources.find(r=>r.id===id).row)).size!==1)return this.fail('FAMILY_RULE','必须同排或同包厢');
  if(this.c.selection==='neighbor'){
   const rows=seats.map(id=>this.s.resources.find(r=>r.id===id).row);
   if(this.s.holds.some(h=>active(h)&&overlap(h,o)&&h.group!==(p.group||'X')&&h.seats.some(id=>rows.includes(this.s.resources.find(r=>r.id===id).row))))return this.fail('NEIGHBOR_RULE','示例策略禁止不同属性组相邻');
  }
  return this.ok();
 }
 endHold(h,state){h.state=state;if(h.usePass)this.s.pass.frozen-=h.units;const o=this.s.orders[h.order];o.status=o.paid?'REFUND_REQUIRED':'CANCELLED';this.emit('RESOURCE_'+state);}
 checks(){const s=this.s,c=this.c,hs=s.holds.filter(active);let noOverlap=true,rule=true,quota=true;
  for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++)if(overlap(hs[i],hs[j])){
   if(hs[i].seats.some(x=>hs[j].seats.includes(x)))noOverlap=false;
   if(c.selection==='neighbor'&&hs[i].group!==hs[j].group&&hs[i].seats.some(x=>hs[j].seats.some(y=>s.resources.find(r=>r.id===x).row===s.resources.find(r=>r.id===y).row)))rule=false;
  }
  for(let seg=0;seg<2;seg++){
   const relevant=hs.filter(h=>h.from<=seg&&h.to>seg);
   for(const ch of ['SELF','OTA'])if(relevant.filter(h=>h.channel===ch).reduce((n,h)=>n+h.seats.length,0)>c.channelLimit)quota=false;
   if(relevant.filter(h=>h.discount).reduce((n,h)=>n+h.seats.length,0)>c.discountLimit)quota=false;
  }
  const pass=!s.pass||(s.pass.used>=0&&s.pass.frozen>=0&&s.pass.used+s.pass.frozen<=s.pass.total&&s.pass.frozen===hs.filter(h=>h.state==='HELD'&&h.usePass).reduce((n,h)=>n+h.units,0)&&s.pass.used===hs.filter(h=>h.state==='SOLD'&&h.usePass).reduce((n,h)=>n+h.units,0));
  const unique=new Set(s.tickets.map(t=>t.order)).size===s.tickets.length&&Object.values(s.orders).every(o=>s.holds.filter(h=>h.order===o.id&&active(h)).length<=1);
  const backed=s.tickets.every(t=>s.holds.some(h=>h.id===t.hold&&h.state==='SOLD'));
  return [{name:'区间资源不重售',ok:noOverlap},{name:'硬性选座规则成立',ok:rule},{name:'渠道 / 优惠配额不超用',ok:quota},{name:'权益余额与流水守恒',ok:pass},{name:'订单占用与出票唯一',ok:unique},{name:'票证有有效资源支撑',ok:backed}];
 }
 step(action,p={},expected='OK'){
  const before=this.snapshot();const result=copy(this.execute(action,p));const after=this.snapshot();
  const delta=Object.keys(after).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k])).map(k=>({field:k,before:before[k],after:after[k]}));
  const entry={seq:this.logs.length+1,time:this.s.time,action,request:copy(p),expected,result,matched:result.code===expected,delta,checks:this.checks()};this.logs.push(entry);
  this.assertions.push({name:'步骤 '+entry.seq+'：'+action+' → '+expected,ok:entry.matched});return entry;
 }
 next(){if(this.cursor>=this.queue.length)return null;const [a,p,e]=this.queue[this.cursor++];return this.step(a,p,e||'OK');}
 runAll(){while(this.cursor<this.queue.length)this.next();return this.report();}
 report(){const checks=this.checks(),terminal=this.scenario?!!this.scenario.verify(this.s):null;const historyOK=this.logs.every(l=>l.checks.every(c=>c.ok));return {scenario:this.scenario?.name||'自由实验',market:this.config.name,config:copy(this.c),bugs:copy(this.bugs),complete:this.cursor===this.queue.length,passed:this.assertions.every(x=>x.ok)&&checks.every(x=>x.ok)&&historyOK&&terminal!==false,terminal,checks,assertions:copy(this.assertions),historyOK,state:this.snapshot(),trace:copy(this.logs)};}
}
function batch(config,bugs={}){return scenarios.map(sc=>{const sim=new Simulator(config,bugs);sim.load(sc.id);return sim.runAll();});}
const api={Simulator,profiles,scenarios,validateConfig,batch,copy};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.RailSim=api;
})(typeof globalThis!=='undefined'?globalThis:this);
