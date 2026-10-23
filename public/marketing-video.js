(()=>{'use strict';
async function render({image,headline='',company='',destinationURL}={}){
 if(typeof image!=='string'||image.length>18000000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)||typeof headline!=='string'||headline.length>400||typeof company!=='string'||company.length>200)throw Error('Gebruik een begrensde, ingebedde JPEG-proefkaart.');
 let destination;try{destination=new URL(destinationURL);}catch{throw Error('Vul de bestaande HTTPS-webshop in.');}if(destination.protocol!=='https:'||destination.username||destination.password)throw Error('Gebruik een HTTPS-webshop zonder aanmeldgegevens.');
 if(typeof MediaRecorder!=='function'||!MediaRecorder.isTypeSupported('video/webm;codecs=vp8'))throw Error('Deze browser ondersteunt de stille WebM-proefvideo niet.');
 const photo=await new Promise((resolve,reject)=>{const img=new Image();const timer=setTimeout(()=>reject(Error('Het proefbeeld kon niet worden geopend.')),5000);img.onload=()=>{clearTimeout(timer);resolve(img);};img.onerror=()=>{clearTimeout(timer);reject(Error('Het proefbeeld is ongeldig.'));};img.src=image;});
 if(!photo.naturalWidth||!photo.naturalHeight||photo.naturalWidth*photo.naturalHeight>40000000)throw Error('Het proefbeeld is te groot of ongeldig.');
 // Detached canvas only: no DOM insertion, remote media, audio or provider calls.
 const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;const ctx=canvas.getContext('2d');if(!ctx||!canvas.captureStream)throw Error('Video-opname wordt niet ondersteund.');
 const duration=15000,ink='#173e34',paper='#f5f1e5';
 function fit(value,start,width){let size=start;while(size>12){ctx.font='600 '+size+'px system-ui, sans-serif';if(ctx.measureText(value).width<=width)return size;size--;}return size;}
 function frame(elapsed){ctx.fillStyle=paper;ctx.fillRect(0,0,720,1280);ctx.fillStyle=ink;ctx.fillRect(0,0,10,1280);ctx.textAlign='center';ctx.textBaseline='middle';
  const name=company.trim();ctx.font='600 '+fit(name,25,640)+'px system-ui, sans-serif';ctx.fillText(name,360,68);
  // The input is the finished poster, already containing its headline. Preserve the complete card.
  const progress=Math.max(0,Math.min(1,(elapsed-1000)/12000)),scale=1+.018*(.5-.5*Math.cos(Math.PI*progress));
  const ratio=Math.min(650/photo.naturalWidth,880/photo.naturalHeight)*scale,w=photo.naturalWidth*ratio,h=photo.naturalHeight*ratio;
  ctx.drawImage(photo,(720-w)/2,540-h/2,w,h);
  ctx.fillStyle='#d4dcc8';ctx.fillRect(52,1055,616,1);ctx.fillStyle=ink;ctx.font='600 29px system-ui, sans-serif';ctx.fillText('Bekijk de digitale boeken',360,1110);
  const host=destination.hostname;ctx.font='500 '+fit(host,27,630)+'px system-ui, sans-serif';ctx.fillText(host,360,1160);ctx.fillStyle='#63756a';ctx.font='400 17px system-ui, sans-serif';ctx.fillText('Stille proefvideo',360,1230);
 }
 frame(0);const stream=canvas.captureStream(30);
 return new Promise((resolve,reject)=>{let recorder,timer,animation,finished=false,started;const chunks=[];
  const cleanup=()=>{clearTimeout(timer);if(animation)cancelAnimationFrame(animation);stream.getTracks().forEach(track=>track.stop());};
  const fail=error=>{if(finished)return;finished=true;cleanup();try{if(recorder&&recorder.state!=='inactive')recorder.stop();}catch{}reject(error instanceof Error?error:Error('De proefvideo kon niet worden opgenomen.'));};
  try{recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:2500000});recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};recorder.onerror=()=>fail(Error('De browser kon de proefvideo niet opnemen.'));recorder.onstop=()=>{if(finished)return;finished=true;cleanup();const blob=new Blob(chunks,{type:'video/webm'});if(!blob.size)return reject(Error('De opgenomen proefvideo is leeg.'));resolve(blob);};
   const draw=now=>{if(finished)return;try{started??=now;const elapsed=now-started;frame(Math.min(elapsed,13000));if(elapsed>=duration){recorder.stop();return;}animation=requestAnimationFrame(draw);}catch(error){fail(error);}};
   timer=setTimeout(()=>fail(Error('De video-opname duurde te lang. Houd dit tabblad zichtbaar en probeer opnieuw.')),25000);recorder.start(500);animation=requestAnimationFrame(draw);
  }catch(error){fail(error);}
 });
}
window.AmcinovaMarketingVideo=Object.freeze({render});
})();
