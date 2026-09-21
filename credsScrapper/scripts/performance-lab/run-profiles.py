"""Profile local immutable Git caches. Manifest: [{name,path,head,objectMiB}]."""
import argparse,json,os,pathlib,secrets,signal,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('manifest');p.add_argument('output');p.add_argument('--commits',type=int,default=100);p.add_argument('--rounds',type=int,default=3);p.add_argument('--timeout',type=int,default=30);p.add_argument('--variants',default='baseline,no-renames,memo,entropy-array');a=p.parse_args()
env={**os.environ,'BENCH_HMAC_KEY':secrets.token_hex(32),'BENCH_COMMIT_LIMIT':str(a.commits)};results=[]
if not a.commits: env.pop('BENCH_COMMIT_LIMIT',None)
for repo in json.load(open(a.manifest)):
 for round in range(a.rounds):
  modes=a.variants.split(',');offset=round%len(modes);modes=modes[offset:]+modes[:offset]
  for variant in modes:
   with tempfile.TemporaryDirectory(prefix='creds-profile-') as tmp:
    out=pathlib.Path(tmp)/'result.json'
    child=subprocess.Popen(['node',str(pathlib.Path(__file__).with_name('profile.cjs')),repo['path'],variant,str(out)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    timeout=False
    try:child.wait(timeout=a.timeout)
    except subprocess.TimeoutExpired:timeout=True;os.killpg(child.pid,signal.SIGKILL);child.wait()
    except KeyboardInterrupt:os.killpg(child.pid,signal.SIGKILL);child.wait();raise
    data=json.loads(out.read_text()) if out.exists() else {}
    results.append({'repo':repo['name'],'head':repo['head'],'round':round,'commitLimit':a.commits,'timeout':timeout,**data})
    pathlib.Path(a.output).write_text(json.dumps(results,indent=2));print(repo['name'],variant,round,'timeout' if timeout else 'done',round_ms:=int(data.get('elapsedMs',0)),flush=True)
