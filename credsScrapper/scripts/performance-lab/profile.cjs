// Read-only scan profiling. Emits aggregates only, never finding values or source.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const {performance} = require('node:perf_hooks');
const [repo, variant, output] = process.argv.slice(2);
const root = path.resolve(__dirname, '../../apps/api/dist/modules/scanner');
if (variant === 'no-renames') {
  const spawn = cp.spawn;
  cp.spawn = (cmd, args, opts) => spawn(cmd, cmd === 'git' && args.includes('log') ? ['-c', 'diff.renames=false', ...args] : args, opts);
}
const metrics = {variant, phase:'start', detectionMs:0, detectionCalls:0, detectionBytes:0, maxTextBytes:0, maxDetectionMs:0, historyReadMs:0, headReadMs:0, commits:0, files:0, findings:0, cacheHits:0};
const entropyModule = require(path.join(root, 'domain/detection/entropy'));
const baselineEntropy = entropyModule.findHighEntropyTokens;
const patternEntries = require(path.join(root, 'domain/detection/patterns')).PATTERNS;
const baselinePatterns = patternEntries.map(x=>x.pattern);
if (variant === 'diagnostic') {
  metrics.patternMs = {}; metrics.entropyMs = 0;
  const entropy = require(path.join(root, 'domain/detection/entropy'));
  const fn = entropy.findHighEntropyTokens;
  entropy.findHighEntropyTokens = text => {const t=performance.now();try{return fn(text);}finally{metrics.entropyMs+=performance.now()-t;}};
  const {PATTERNS} = require(path.join(root, 'domain/detection/patterns'));
  for(const entry of PATTERNS){const re=entry.pattern;entry.pattern={*[Symbol.matchAll](text){
    const iterator=text.matchAll(re);
    for(;;){const t=performance.now();const item=iterator.next();metrics.patternMs[entry.secretType]=(metrics.patternMs[entry.secretType]??0)+performance.now()-t;if(item.done)return;yield item.value;}
  }};}
}
if (variant === 'entropy-array' || variant === 'fast-node' || variant === 'verify-fast') {
  const entropy = require(path.join(root, 'domain/detection/entropy'));
  entropy.findHighEntropyTokens = text => {
    const out=[];
    for(const match of text.matchAll(/[A-Za-z0-9+]{32,}={0,2}/g)) {
      const counts=new Uint32Array(128);let digits=0;
      for(let i=0;i<match[0].length;i++){const c=match[0].charCodeAt(i);counts[c]++;if(c>=48&&c<=57)digits++;}
      if(digits<2)continue;let h=0;
      for(const n of counts)if(n){const p=n/match[0].length;h-=p*Math.log2(p);}
      if(h>4)out.push({token:match[0],index:match.index});
    }
    return out;
  };
}
if (variant === 'prefilter' || variant === 'fast-node' || variant === 'verify-fast') {
  const {PATTERNS}=require(path.join(root,'domain/detection/patterns'));
  for(const entry of PATTERNS){
    const re=entry.pattern;
    const required={terraform_cloud_token:'.atlasv1.',mailchimp_api_key:'-us'}[entry.secretType];
    if(required) entry.pattern={*[Symbol.matchAll](text){if(text.includes(required))yield* text.matchAll(re);}};
    if(entry.secretType==='aws_secret_access_key') entry.pattern={*[Symbol.matchAll](text){
      const lower=text.toLowerCase();
      if(['aws_secret_access_key','aws_secret_key','secret_access_key','secretaccesskey','awssecretaccesskey'].some(x=>lower.includes(x)))yield* text.matchAll(re);
    }};
  }
}
const engine = require(path.join(root, 'domain/detection/engine'));
const original = engine.scanText;
const cache = new Map(); let cacheBytes = 0;
engine.scanText = (text) => {
  const started = performance.now();
  const bytes = Buffer.byteLength(text); metrics.detectionCalls++; metrics.detectionBytes += bytes;
  metrics.maxTextBytes=Math.max(metrics.maxTextBytes,bytes);
  try {
    if (variant === 'memo') {
      const key = crypto.createHash('sha256').update(text).digest('hex');
      if (cache.has(key)) {metrics.cacheHits++; return cache.get(key);}
      const findings = original(text);
      const size = bytes + Buffer.byteLength(JSON.stringify(findings));
      if(size < 32*1024*1024) {
        if(cacheBytes+size>32*1024*1024) {cache.clear();cacheBytes=0;}
        cache.set(key,findings);cacheBytes+=size;
      }
      return findings;
    }
    if(variant==='verify-fast') {
      const fastPatterns=patternEntries.map(x=>x.pattern);const fastEntropy=entropyModule.findHighEntropyTokens;
      const candidate=original(text);
      patternEntries.forEach((x,i)=>x.pattern=baselinePatterns[i]);entropyModule.findHighEntropyTokens=baselineEntropy;
      const reference=original(text);
      patternEntries.forEach((x,i)=>x.pattern=fastPatterns[i]);entropyModule.findHighEntropyTokens=fastEntropy;
      metrics.verifiedCalls=(metrics.verifiedCalls??0)+1;
      if(JSON.stringify(candidate)!==JSON.stringify(reference))throw Error('Variant result mismatch');
      return candidate;
    }
    return original(text);
  } finally {
    const ms=performance.now()-started;metrics.detectionMs+=ms;metrics.maxDetectionMs=Math.max(metrics.maxDetectionMs,ms);
    save();
  }
};
const {GitCliAdapter}=require(path.join(root,'infrastructure/git/git-cli-adapter'));
const {RunScanJobUseCase}=require(path.join(root,'application/use-cases/run-scan-job.use-case'));
const git=new GitCliAdapter();
if(process.env.BENCH_COMMIT_LIMIT){const spawn=cp.spawn;cp.spawn=(cmd,args,opts)=>spawn(cmd,cmd==='git'&&args.includes('log')?[...args,'--max-count='+Number(process.env.BENCH_COMMIT_LIMIT)]:args,opts);}
// Existing immutable cache: isolate scan cost from acquisition; no cache mutation.
git.cloneBare=async()=>{};
for(const [name,key,count] of [['iterCommitDiffs','historyReadMs','commits'],['readFilesAtHead','headReadMs','files']]) {
 const fn=git[name].bind(git);
 git[name]=async function* (...args) {
  const it=fn(...args)[Symbol.asyncIterator]();
  try {for(;;){const t=performance.now();const next=await it.next();metrics[key]+=performance.now()-t;if(next.done)break;metrics[count]++;yield next.value;}}
  finally {await it.return?.();}
 };
}
if(variant==='head-only') git.iterCommitDiffs=async function*(){};
const start=performance.now();
let lastSave=0;
function save(force=false){if(!force&&performance.now()-lastSave<250)return;lastSave=performance.now();fs.writeFileSync(output,JSON.stringify({...metrics,elapsedMs:performance.now()-start,peakRssMiB:process.resourceUsage().maxRSS/1024}));}
// Per-run ephemeral HMAC permits comparison without publishing credential hashes.
const hash=crypto.createHmac('sha256',process.env.BENCH_HMAC_KEY);
new RunScanJobUseCase(git).execute({repoId:0,owner:'benchmark',name:'local'},repo,repo,e=>{
 if(e.type==='finding'){metrics.findings++;hash.update(JSON.stringify(e));}
 else {metrics.phase=e.message.includes('working tree')?'head':e.message.includes('history')?'history':'setup';save(true);}
}).then(r=>{metrics.status=r.status;metrics.fingerprint=hash.digest('hex');metrics.phase='finished';save(true);}).catch(()=>{metrics.status='error';save(true);process.exitCode=1;});
