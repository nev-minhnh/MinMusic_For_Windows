// Generates placeholder icons (flat accent square with a play triangle). Replace with final art later.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
function crc32(buf){let c,crc=~0;for(const b of buf){c=(crc^b)&255;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xedb88320:c>>>1;crc=(crc>>>8)^c;}return ~crc>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);}
function png(s){
  const raw=Buffer.alloc((s*4+1)*s);
  for(let y=0;y<s;y++){raw[y*(s*4+1)]=0;for(let x=0;x<s;x++){
    const o=y*(s*4+1)+1+x*4;const u=x/s,v=y/s;
    const tri=u>0.36&&u<0.72&&Math.abs(v-0.5)<(0.72-u)*0.9*(0.36/0.36)*0.62+0.0&&Math.abs(v-0.5)<(u-0.34)*1.5;
    const inTri=u>0.36&&u<0.74&&Math.abs(v-0.5)<(0.74-u)*1.3;
    const c=inTri?[255,255,255]:[124,92,255];
    raw[o]=c[0];raw[o+1]=c[1];raw[o+2]=c[2];raw[o+3]=255;}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(s,0);ihdr.writeUInt32BE(s,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
}
mkdirSync("src-tauri/icons",{recursive:true});
const sizes=[16,32,48,256];const pngs=sizes.map(png);
const hdr=Buffer.alloc(6);hdr.writeUInt16LE(1,2);hdr.writeUInt16LE(sizes.length,4);
let off=6+16*sizes.length;const dir=[];
sizes.forEach((s,i)=>{const e=Buffer.alloc(16);e[0]=s>=256?0:s;e[1]=s>=256?0:s;e.writeUInt16LE(1,4);e.writeUInt16LE(32,6);e.writeUInt32LE(pngs[i].length,8);e.writeUInt32LE(off,12);off+=pngs[i].length;dir.push(e);});
writeFileSync("src-tauri/icons/icon.ico",Buffer.concat([hdr,...dir,...pngs]));
writeFileSync("src-tauri/icons/icon.png",png(256));
writeFileSync("src-tauri/icons/32x32.png",png(32));
