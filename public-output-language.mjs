import {readFileSync} from 'node:fs';
const dictionary=JSON.parse(readFileSync(new URL('./public-output-english.json',import.meta.url),'utf8'));
const normalize=s=>s.trim().replace(/\s+/g,' ');
const exact=new Map(Object.entries(dictionary).map(([a,b])=>[normalize(a),b]));
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.entries(dictionary).filter(([a,b])=>a.includes('__VALUE__')&&/[A-Za-z]{2}/.test(a.replace(/__VALUE__/g,''))&&a.split('__VALUE__').length===b.split('__VALUE__').length).map(([a,b])=>({match:new RegExp('^'+normalize(a).split('__VALUE__').map(escape).join('([\\s\\S]*?)')+'$'),text:b}));
export function publicOutputText(text,language){if(language!=='en'||typeof text!=='string')return text;const normalized=normalize(text);if(exact.has(normalized))return exact.get(normalized);for(const p of patterns){const match=p.match.exec(normalized);if(match){let i=0;return p.text.replace(/__VALUE__/g,()=>match[++i]);}}return text;}
export function localizePublicResult(value,language){if(language!=='en')return value;if(typeof value==='string')return publicOutputText(value,language);if(Array.isArray(value))return value.map(v=>localizePublicResult(v,language));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,localizePublicResult(v,language)]));return value;}
