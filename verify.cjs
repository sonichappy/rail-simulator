'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const R=require('./engine.js');const results=[];
function test(name,fn){try{fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
for(const [key,p]of Object.entries(R.profiles))for(const sc of R.scenarios)test(key+' / '+sc.name,()=>{const x=new R.Simulator(p);x.load(sc.id);assert.equal(x.runAll().passed,true);});
for(const [bug,scenario,check]of [['skipVersion','rule','硬性选座规则成立'],['skipQuota','quota','渠道 / 优惠配额不超用'],['skipIdempotency','duplicate','区间资源不重售']])test('故障检出 / '+bug,()=>{const x=new R.Simulator(R.profiles.A,{[bug]:true});x.load(scenario);const report=x.runAll();assert.equal(report.passed,false);assert.equal(report.checks.find(c=>c.name===check).ok,false);});
function newSim(c={}){return new R.Simulator({...R.profiles.A,...c});}
function lock(x,id,seat,p={}){assert.equal(x.execute('quote',{order:id,...p}).code,'OK');assert.equal(x.execute('validate',{order:id,seats:[seat]}).code,'OK');return x.execute('lock',{order:id,requestId:'L'+id,...(p.entitlement?{usePass:true}:{})});}
test('族群偏好 / 同排推荐与跨排拒绝',()=>{const x=newSim();x.execute('quote',{order:'A',units:2});assert.equal(x.execute('validate',{order:'A',seats:['S1','S3'],family:true}).code,'FAMILY_RULE');const res=x.execute('recommend',{order:'A',family:true});assert.equal(res.code,'OK');assert.deepEqual(res.decision.seats,['S1','S2']);});
test('区间额度 / 同座非重叠区间只占各段额度',()=>{const x=newSim({channelLimit:1});assert.equal(lock(x,'A','S1',{from:0,to:1}).code,'OK');assert.equal(lock(x,'B','S1',{from:1,to:2}).code,'OK');assert.equal(x.checks().every(c=>c.ok),true);});
test('幂等键 / 不同订单不能复用同一键',()=>{const x=newSim();lock(x,'A','S1');x.execute('quote',{order:'B'});x.execute('validate',{order:'B',seats:['S3']});assert.equal(x.execute('lock',{order:'B',requestId:'LA'}).code,'IDEMPOTENCY_CONFLICT');});
test('资源失败 / 不得冻结权益次数',()=>{const x=newSim({passUses:1});x.execute('buyPass',{order:'P'});lock(x,'A','S1');x.execute('quote',{order:'B',entitlement:true});assert.equal(x.execute('validate',{order:'B',seats:['S1']}).code,'UNAVAILABLE');assert.equal(x.s.pass.frozen,0);});
test('权益最后一次 / 并发使用不能超扣',()=>{const x=newSim({passUses:1});x.execute('buyPass',{order:'P'});assert.equal(lock(x,'A','S1',{entitlement:true}).code,'OK');assert.equal(lock(x,'B','S3',{entitlement:true}).code,'ENTITLEMENT_INSUFFICIENT');assert.equal(x.s.pass.frozen,1);assert.equal(x.s.holds.length,1);});
test('先确认后到期 / 已售不会被定时释放',()=>{const x=newSim();lock(x,'A','S1');x.execute('pay',{order:'A'});x.execute('confirm',{order:'A'});x.execute('advance',{minutes:101});assert.equal(x.s.holds[0].state,'SOLD');assert.equal(x.s.tickets.length,1);});
test('无支付 / 禁止普通票确认',()=>{const x=newSim();lock(x,'A','S1');assert.equal(x.execute('confirm',{order:'A'}).code,'PAYMENT_REQUIRED');assert.equal(x.s.tickets.length,0);});
test('支付重复 / 只产生一笔收款',()=>{const x=newSim();lock(x,'A','S1');x.execute('pay',{order:'A'});x.execute('pay',{order:'A'});assert.equal(x.s.payments.length,1);});
test('报价有效期 / 锁定后保存价格承诺',()=>{const x=newSim({quoteTTL:2,holdTTL:10});lock(x,'A','S1');x.execute('advance',{minutes:3});assert.equal(x.execute('pay',{order:'A'}).code,'OK');assert.equal(x.execute('confirm',{order:'A'}).code,'OK');});
test('市场配置 / 非法模板拒绝',()=>assert.throws(()=>newSim({count:0})));
const report={generatedAt:new Date().toISOString(),scope:'42 个市场场景回归、3 个故障检出及补充边界测试；不代表生产系统认证',total:results.length,passed:results.filter(x=>x.passed).length,results};
fs.writeFileSync(path.join(__dirname,'verification-report.json'),JSON.stringify(report,null,2));
console.log(report.passed+'/'+report.total+' checks passed');for(const r of results.filter(x=>!x.passed))console.error(r.name,r.error);if(report.passed!==report.total)process.exitCode=1;
