import sharp from 'sharp';
const p='magia-exedra-character-three/shaders/RDToon_AngelRingMap.png'; const m=await sharp(p).metadata(); const {data,info}=await sharp(p).raw().toBuffer({resolveWithObject:true}); let min=255,max=0,avg=0; for(const v of data){min=Math.min(min,v);max=Math.max(max,v);avg+=v} console.log({m,channels:info.channels,min,max,avg:avg/data.length});
