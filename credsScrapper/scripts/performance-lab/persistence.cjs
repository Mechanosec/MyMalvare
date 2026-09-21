// Synthetic findings only; never opens the development database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {PrismaClient}=require('../../node_modules/@prisma/client');
const {PrismaStateRepository}=require('../../apps/api/dist/modules/scanner/infrastructure/persistence/prisma-state-repository');
(async()=>{const rows=[];for(const [events,unique] of [[10000,10000],[100000,1000]])for(let run=0;run<3;run++){
 const dir=fs.mkdtempSync('/tmp/creds-persistence-');const db=new PrismaClient({datasources:{db:{url:'file:'+path.join(dir,'bench.db')}}});
 try{
 await db.$executeRawUnsafe(`CREATE TABLE findings(id INTEGER PRIMARY KEY AUTOINCREMENT,repo_id INTEGER NOT NULL,owner TEXT NOT NULL,name TEXT NOT NULL,file_path TEXT NOT NULL,commit_sha TEXT NOT NULL,secret_type TEXT NOT NULL,secret_value TEXT NOT NULL,line_number INTEGER,found_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,context TEXT,status TEXT NOT NULL DEFAULT 'unknown',checked_at DATETIME,test_reason TEXT,leak_commits TEXT NOT NULL DEFAULT '[]')`);
 const input=Array.from({length:events},(_,i)=>({filePath:'fixture.txt',commitSha:crypto.createHash('sha1').update(String(Math.floor(i/unique))).digest('hex'),secretType:'generic_high_entropy',secretValue:'synthetic-fixture-'+i%unique,lineNumber:1,context:null}));
 const repo=new PrismaStateRepository(db);const start=performance.now();await repo.addFindings(1,'fixture','benchmark',input);const ms=performance.now()-start;
 const saved=await db.finding.count();if(saved!==unique)throw Error('Persistence mismatch');rows.push({events,unique,ms,run});
 }finally{await db.$disconnect();fs.rmSync(dir,{recursive:true});}
}fs.writeFileSync(process.argv[2],JSON.stringify(rows,null,2));console.log('Synthetic persistence measurements complete');})().catch(()=>{console.error('Synthetic persistence benchmark failed');process.exitCode=1;});
