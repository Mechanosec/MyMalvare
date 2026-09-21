"""Bounded public GitHub acquisition benchmark; no auth and no source output."""
import concurrent.futures,hashlib,json,os,pathlib,shutil,signal,subprocess,sys,tarfile,tempfile,time,urllib.request,io
name=sys.argv[1];expected=sys.argv[2];dest=pathlib.Path(sys.argv[3]);rows=[]
def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':'credsScrapper-performance-lab','Accept':'application/vnd.github+json'})
 with urllib.request.urlopen(req,timeout=20) as r:
  data=r.read(200*1024*1024+1)
  if len(data)>200*1024*1024:raise ValueError('response_limit')
  return data
for mode in ['full-git','shallow-git','archive','archive','archive','api-blobs']:
 start=time.perf_counter();tmp=pathlib.Path(tempfile.mkdtemp(prefix='creds-acquire-'));record={'mode':mode};p=None
 try:
  if mode.endswith('git'):
   cmd=['git','-c','credential.helper=','clone','--bare',*(['--depth=1','--single-branch'] if mode=='shallow-git' else []),'--','https://github.com/'+name+'.git',str(tmp/'repo')]
   p=subprocess.Popen(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_ASKPASS':''})
   p.wait(timeout=35)
   if p.returncode:raise ValueError('git_failed')
   head=subprocess.check_output(['git','-C',str(tmp/'repo'),'rev-parse','HEAD'],text=True).strip()
   record['sameHead']=head==expected
   record['diskBytes']=sum(f.stat().st_size for f in (tmp/'repo').rglob('*') if f.is_file())
   record['files']=len(subprocess.check_output(['git','-C',str(tmp/'repo'),'ls-tree','-r','--name-only',expected]).splitlines())
  elif mode=='archive':
   data=get(f'https://api.github.com/repos/{name}/tarball/{expected}');record['transferBytes']=len(data)
   with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tar:
    files=[m for m in tar if m.isfile()];record['files']=len(files);record['contentBytes']=sum(m.size for m in files)
   record['sameHead']=True
  else:
   tree=json.loads(get(f'https://api.github.com/repos/{name}/git/trees/{expected}?recursive=1'))
   if tree.get('truncated'):raise ValueError('truncated_tree')
   blobs=[x for x in tree['tree'] if x['type']=='blob']
   if len(blobs)>40:raise ValueError('request_budget')
   def blob(x):
    import base64
    data=json.loads(get(f'https://api.github.com/repos/{name}/git/blobs/{x["sha"]}'))
    return len(base64.b64decode(data['content']))
   with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: sizes=list(pool.map(blob,blobs))
   record.update(files=len(blobs),contentBytes=sum(sizes),requests=1+len(blobs),sameHead=True)
  record['status']='done'
 except subprocess.TimeoutExpired:
  os.killpg(p.pid,signal.SIGKILL);p.wait();record['status']='timeout'
 except Exception as e:record['status']=type(e).__name__ # never output response/credential content
 finally:
  record['ms']=(time.perf_counter()-start)*1000;shutil.rmtree(tmp);rows.append(record);dest.write_text(json.dumps({'repo':name,'head':expected,'runs':rows},indent=2));print(mode,record['status'],round(record['ms']),flush=True)
