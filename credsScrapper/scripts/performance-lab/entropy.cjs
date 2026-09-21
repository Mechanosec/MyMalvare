// Synthetic equivalent-work kernel comparison; no real credentials.
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const {findHighEntropyTokens}=require('../../apps/api/dist/modules/scanner/domain/detection/entropy');
const cases={clean:'const ordinaryIdentifier = true;\n'.repeat(60000),dense:('VALUE=\'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9\'\n').repeat(40000),longline:('a'.repeat(80000)+';Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9;').repeat(20)};
function ascii(text){const out=[];const re=/[A-Za-z0-9+]{32,}={0,2}/g;for(const match of text.matchAll(re)){const counts=new Uint32Array(128);let digits=0;for(let i=0;i<match[0].length;i++){const c=match[0].charCodeAt(i);counts[c]++;if(c>=48&&c<=57)digits++;}if(digits<2)continue;let h=0;for(let c=0;c<128;c++){if(counts[c]){const p=counts[c]/match[0].length;h-=p*Math.log2(p);}}if(h>4)out.push({index:match.index,token:match[0]});}return out;}
cases.edges = [
 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789==',
 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789=',
 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789===',
 'A'.repeat(31), 'A'.repeat(32), 'ABCD0123'.repeat(5),
 'Qwerty0123456789asdfghjklzxcvbnmUIOP',
].join(';').repeat(1000);
const all=[];
for(const [name,text]of Object.entries(cases)){
 const results=[];for(const [mode,fn]of [['node-current',findHighEntropyTokens],['node-typed-array',ascii]])for(let run=0;run<4;run++){const t=performance.now();const out=fn(text);const ms=performance.now()-t;if(run){const hash=require('node:crypto').createHash('sha256');for(const x of out)hash.update(`${x.index}:${x.token.length}\n`);results.push({mode,ms,count:out.length,indexSum:out.reduce((n,x)=>n+x.index,0),fingerprint:hash.digest('hex')});}}
 const temp=fs.mkdtempSync('/tmp/creds-entropy-input-');const input=path.join(temp,'fixture.txt');fs.writeFileSync(input,text);
 const go=JSON.parse(cp.execFileSync(process.argv[2],[input],{encoding:'utf8',timeout:20000}));fs.rmSync(temp,{recursive:true});for(const row of go)results.push({...row,mode:'go-'+row.mode});
 const identical=new Set(results.map(x=>`${x.count}:${x.fingerprint}`)).size===1;if(!identical)throw Error('Kernel results differ');all.push({name,bytes:Buffer.byteLength(text),identical,results});
}
fs.writeFileSync(process.argv[3],JSON.stringify(all,null,2));console.log('All synthetic entropy kernels agree');
