import test from 'node:test';import assert from 'node:assert/strict';
import {checkAIInput,checkAIProposal} from './quote-ai.mjs';
const catalog=[{id:'front',name:'Fronten',unit:'m2',price:350},{id:'item-0',name:'Werkblad (60 cm diep)',unit:'m',price:300},{id:'item-1',name:'Spoelbak',unit:'stuk',price:350},{id:'item-2',name:'Apparatuur',unit:'stuk',price:0}];
const front={catalogId:'front',sourceId:null,heightMm:720,widthMm:596,quantity:7,detail:''};
const run=(description,lines=[front],existingLines=[])=>checkAIProposal({summary:'Keukenrenovatie',questions:[],lines},checkAIInput({description,kind:'Keukenrenovatie',catalog,existingLines}));
test('requested worktop survives model omission without inventing length or appliances',()=>{
 const p=run('7 fronten en werkblad');const top=p.lines.find(l=>l.catalogId==='item-0');assert.ok(top);assert.equal(top.quantity,null);assert.ok(p.questions.some(q=>/Werkbladlengte nog invullen/.test(q)));assert.ok(p.suggestions.some(q=>/Spoelbak: bestaande hergebruiken/.test(q)));assert.ok(p.suggestions.some(q=>/Kookplaat: bestaande hergebruiken/.test(q)));assert.ok(p.suggestions.some(q=>/uitsparingen/.test(q)));assert.equal(p.lines.length,2);
});
test('known worktop length retained with checks and no duplicate row',()=>{
 const top={catalogId:'item-0',quantity:3.2,heightMm:null,widthMm:null,detail:'Wit'};
 const p=run('7 fronten en werkblad van 3,2 meter',[front,top]);assert.equal(p.lines.filter(l=>l.catalogId==='item-0').length,1);assert.equal(p.lines[1].quantity,3.2);assert.deepEqual(p.questions,[]);
 const existing=run('7 fronten en werkblad',[front],[top]);assert.equal(existing.lines[1].quantity,3.2);assert.equal(existing.lines[1].detail,'Wit');
});
test('worktop checks are not added for a front-only or explicitly excluded worktop',()=>{
 for(const text of ['7 fronten vervangen','7 fronten zonder nieuw werkblad']){const p=run(text);assert.equal(p.lines.length,1);assert.deepEqual(p.suggestions,[]);}
});
