(()=>{'use strict';
const invalid=()=>Error('Gebruik een ingebedde JPEG-, PNG- of WebP-afbeelding en een vierkant of staand formaat.');
function lines(ctx,value,width){const result=[];let row='';for(const word of value.split(/\s+/)){if(ctx.measureText(word).width>width){if(row){result.push(row);row='';}let part='';for(const letter of word){if(ctx.measureText(part+letter).width>width&&part){result.push(part);part=letter;}else part+=letter;}row=part;continue;}const next=row?row+' '+word:word;if(ctx.measureText(next).width>width&&row){result.push(row);row=word;}else row=next;}if(row)result.push(row);return result;}
function layout(ctx,value,width,height,start,min=18,weight=700){for(let size=start;size>=min;size--){ctx.font=weight+' '+size+'px system-ui, sans-serif';const rows=lines(ctx,value,width),lineHeight=Math.ceil(size*1.18);if(rows.length*lineHeight<=height)return{rows,size,lineHeight};}throw Error('De tekst is te lang voor een leesbaar beeld. Maak de kop korter.');}
async function render({image,headline='',subtitle='',company='',format='square'}={}){
 if(!['square','portrait'].includes(format)||typeof image!=='string'||image.length>18000000||!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))throw invalid();
 for(const value of [headline,subtitle,company])if(typeof value!=='string'||value.length>1600)throw invalid();
 const photo=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(invalid());img.src=image;});
 if(!photo.naturalWidth||!photo.naturalHeight||photo.naturalWidth*photo.naturalHeight>40000000)throw invalid();
 const width=1080,height=format==='portrait'?1350:1080;
 // OffscreenCanvas avoids attaching anything to, or modifying, the page DOM.
 if(typeof OffscreenCanvas!=='function')throw Error('Deze browser ondersteunt de beeldrenderer niet.');
 const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');if(!ctx)throw Error('Het voorbeeldbeeld kon niet worden opgebouwd.');
 const ink='#173e34',paper='#f5f1e5',accent='#8a9d69';ctx.fillStyle=paper;ctx.fillRect(0,0,width,height);
 ctx.fillStyle=ink;ctx.fillRect(0,0,16,height);ctx.fillStyle=accent;ctx.fillRect(58,54,52,5);
 const textHeight=format==='portrait'?224:190,title=layout(ctx,headline.trim(),964,textHeight,format==='portrait'?68:60,26);
 ctx.fillStyle=ink;ctx.textBaseline='top';ctx.font='700 '+title.size+'px system-ui, sans-serif';title.rows.forEach((row,i)=>ctx.fillText(row,58,83+i*title.lineHeight));
 const subtitleTop=83+title.rows.length*title.lineHeight+14,subtitleHeight=subtitle.trim()?64:0;
 if(subtitle.trim()){const sub=layout(ctx,subtitle.trim(),964,subtitleHeight,25,16,400);ctx.font='400 '+sub.size+'px system-ui, sans-serif';sub.rows.forEach((row,i)=>ctx.fillText(row,58,subtitleTop+i*sub.lineHeight));}
 const areaTop=Math.max(format==='portrait'?330:280,subtitleTop+subtitleHeight+24),areaBottom=height-102;
 const areaHeight=areaBottom-areaTop;if(areaHeight<180)throw Error('Maak de beeldtekst korter voor voldoende ruimte voor de boekomslag.');
 const scale=Math.min(900/photo.naturalWidth,areaHeight/photo.naturalHeight),drawWidth=photo.naturalWidth*scale,drawHeight=photo.naturalHeight*scale,x=(width-drawWidth)/2,y=areaTop+(areaHeight-drawHeight)/2;
 ctx.save();ctx.shadowColor='rgba(23,62,52,.16)';ctx.shadowBlur=18;ctx.shadowOffsetY=8;ctx.fillStyle='#fff';ctx.fillRect(x,y,drawWidth,drawHeight);ctx.restore();
 // Contain the complete source cover: never crop or repaint its text or artwork.
 ctx.drawImage(photo,x,y,drawWidth,drawHeight);
 ctx.fillStyle='#d4dcc8';ctx.fillRect(58,height-72,964,1);
 const footer=layout(ctx,company.trim(),964,40,23,14,500);ctx.fillStyle=ink;ctx.font='500 '+footer.size+'px system-ui, sans-serif';footer.rows.forEach((row,i)=>ctx.fillText(row,58,height-53+i*footer.lineHeight));
 const blob=await canvas.convertToBlob({type:'image/jpeg',quality:.9});
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Het beeld kon niet worden opgeslagen.'));reader.readAsDataURL(blob);});
}
window.AmcinovaMarketingVisual=Object.freeze({render});
})();
