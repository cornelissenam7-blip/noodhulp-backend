import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
test('form preserves same request/body while delivery pending; accepted is not inbox delivery',async()=>{
 const fields={name:{value:'',disabled:false},email:{value:'fixture@example.invalid',disabled:false},proposal:{checked:false,disabled:false,addEventListener(){}},help:{value:'',disabled:false}},button={disabled:false,textContent:''},status={textContent:''},label={hidden:true},privacy={};let submit;
 const form={hidden:true,elements:{namedItem:name=>fields[name]},proposal:fields.proposal,help:fields.help,querySelector:()=>button,querySelectorAll:()=>Object.values(fields),reportValidity:()=>true,addEventListener:(event,fn)=>{submit=fn;},reset(){fields.name.value='';fields.email.value='';fields.proposal.checked=false;fields.help.value='';}};
 const bodies=[];let accepted=false;const context={setTimeout,clearTimeout,AbortController,document:{querySelector:s=>s==='#workbook'?form:s==='#status'?status:s==='#help-label'?label:privacy},crypto:{randomUUID},URL,fetch:async(url,options)=>{if(options?.method!=='POST')return{json:async()=>({enabled:true,delivery:'email',privacyUrl:'https://amcinova.com/privacy-test-only'})};bodies.push(JSON.parse(options.body));return{ok:true,status:202,json:async()=>({saved:true,emailAccepted:accepted,deliveryStatus:accepted?'accepted':'pending'})};}};
 const local=new URL('./workbook.js',import.meta.url),source=existsSync(local)?local:new URL('../agents/static/workbook.js',import.meta.url);vm.runInNewContext(readFileSync(source,'utf8'),context);await new Promise(resolve=>setImmediate(resolve));assert.equal(form.hidden,false);
 await submit({preventDefault(){}});assert.ok(status.textContent.includes('opgeslagen'));assert.ok(status.textContent.includes('nog niet bevestigd'));assert.equal(fields.email.disabled,true);accepted=true;await submit({preventDefault(){}});assert.deepEqual(bodies[0],bodies[1]);assert.ok(status.textContent.includes('maildienst'));assert.ok(status.textContent.includes('Ontvangst in je inbox is nog niet bevestigd'));assert.equal(fields.email.disabled,false);
});
test('cold start keeps submission busy; timeout claims no storage or delivery and preserves retry',async()=>{
 const fields={name:{value:'',disabled:false},email:{value:'fixture@example.invalid',disabled:false},proposal:{checked:false,disabled:false,addEventListener(){}},help:{value:'',disabled:false}},button={disabled:false},status={textContent:''},label={},privacy={};let submit;
 const form={hidden:true,elements:{namedItem:name=>fields[name]},proposal:fields.proposal,help:fields.help,querySelector:()=>button,querySelectorAll:()=>Object.values(fields),reportValidity:()=>true,addEventListener:(_event,fn)=>{submit=fn;},reset(){}};
 const timers=new Map(),bodies=[];let serial=0,respond=false;
 const context={setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id),AbortController,URL,crypto:{randomUUID},document:{querySelector:s=>s==='#workbook'?form:s==='#status'?status:s==='#help-label'?label:privacy},fetch:async(_url,options)=>{if(options.method!=='POST')return{json:async()=>({enabled:true,delivery:'email',privacyUrl:'https://amcinova.com/privacy-test-only'})};bodies.push(JSON.parse(options.body));if(respond)return{ok:true,status:200,json:async()=>({saved:true,emailAccepted:true})};return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true}));}};
 const local=new URL('./workbook.js',import.meta.url),source=existsSync(local)?local:new URL('../agents/static/workbook.js',import.meta.url);vm.runInNewContext(readFileSync(source,'utf8'),context);await new Promise(resolve=>setImmediate(resolve));assert.equal(form.hidden,false);
 const waiting=submit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));assert.equal(button.disabled,true);await submit({preventDefault(){}});assert.equal(bodies.length,1);
 assert.ok([...timers.values()].some(t=>t.ms===120000));[...timers.values()].find(t=>t.ms===12000).fn();assert.ok(status.textContent.includes('nog niet bevestigd'));assert.equal(button.disabled,true);
 [...timers.values()].find(t=>t.ms===120000).fn();await waiting;assert.equal(button.disabled,false);assert.ok(status.textContent.includes('De verwerking kan al gestart zijn'));assert.equal(status.textContent.includes('opgeslagen'),false);assert.equal(fields.email.disabled,true);
 respond=true;await submit({preventDefault(){}});assert.deepEqual(bodies[0],bodies[1]);assert.ok(status.textContent.includes('maildienst'));assert.equal(timers.size,0);
});

