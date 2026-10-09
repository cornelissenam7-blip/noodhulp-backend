import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
test('admin renders HTML-like input and status as text; logout removes PII',async()=>{
 const created=[];function element(tag){const e={tag,children:[],listeners:{},hidden:false,textContent:'',style:{},append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},setAttribute(){},addEventListener(k,fn){this.listeners[k]=fn;}};Object.defineProperty(e,'innerHTML',{set(){throw Error('Unsafe HTML renderer');}});created.push(e);return e;}
 const dashboard=element('dashboard'),logout=element('logout'),refresh=element('refresh'),nav=element('nav');const document={createElement:element,querySelector:s=>s==='[data-admin-dashboard]'?dashboard:s==='[data-admin-logout]'?logout:s==='[data-admin-refresh]'?refresh:s==='nav[aria-label="Admin navigatie"]'?nav:null};
 const dangerous='<img src=x onerror=alert(1)>',context={document,window:{localStorage:{getItem:()=> 'fake-admin'}},MutationObserver:class{observe(){}},fetch:async()=>({ok:true,json:async()=>({ok:true,nextOffset:null,requests:[{name:dangerous,email:'fixture@example.invalid',help:'<script>alert(1)</script>',proposalRequested:true,createdAt:'2026-10-09T00:00:00Z',source:'workbook',revision:'test',deliveryStatus:'accepted',retention:{followUpStatus:'none',eligibleAt:'2027-04-09T00:00:00Z'}}]})})};
 const localSource=new URL('./admin-workbook.js',import.meta.url),source=existsSync(localSource)?localSource:new URL('../admin/admin-workbook.js',import.meta.url);
 vm.runInNewContext(readFileSync(source,'utf8'),context);await new Promise(resolve=>setImmediate(resolve));const cells=created.filter(e=>e.tag==='td');assert.equal(cells[0].textContent,dangerous);assert.equal(cells[2].textContent,'<script>alert(1)</script>');assert.equal(cells[3].textContent,'Ja');assert.ok(cells[6].textContent.includes('inbox niet bevestigd'));const body=created.find(e=>e.tag==='tbody');assert.equal(body.children.length,1);logout.listeners.click();assert.equal(body.children.length,0);
});
