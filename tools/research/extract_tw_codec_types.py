#!/usr/bin/env python3
from __future__ import annotations
import argparse,json,re,subprocess
from pathlib import Path

TARGETS=(
 'ReDrive.Config.AppCryptoConfig','ReDrive.Config.AppMsgPackConfig','ReDrive.Config.AppPokkeConfig',
 'A2.Http.MsgPackDefaultConfig','A2.Http.PokkeDefaultConfig','A2.Http.RequestEncoder',
 'A2.Http.PokkeMsgPackAPI','A2.Http.PokkeMsgPackAPIFactory','A2.Http.PokkeReqContainer','A2.Http.PokkeResContainer',
 'A2.Crypto.BasicCrypto','A2.Crypto.Hash',
 'A2.ResourceManager.ResourceMsgPackDataApi','A2.ResourceManager.ResourceCrypto',
)

def run(command:list[str]):
 return subprocess.run(command,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,errors='replace',check=False,timeout=240)

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--ilspy',type=Path,required=True); ap.add_argument('--assembly',type=Path,required=True); ap.add_argument('--out',type=Path,required=True); args=ap.parse_args(); args.out.mkdir(parents=True,exist_ok=True)
 listed=run([str(args.ilspy),'-l','c',str(args.assembly)])
 available=[]
 for line in listed.stdout.splitlines():
  value=re.sub(r'^(Class|Struct|Interface|Enum)\s+','',line.strip())
  if value: available.append(value)
 records=[]
 for target in TARGETS:
  short=target.rsplit('.',1)[-1]
  candidates=[x for x in available if x==target or x.startswith(target+'`') or x.endswith('.'+short)]
  for type_name in dict.fromkeys(candidates):
   safe=re.sub(r'[^A-Za-z0-9_.-]+','_',type_name)
   result=run([str(args.ilspy),'-t',type_name,str(args.assembly)])
   path=args.out/f'{safe}.cs'; path.write_text(result.stdout[:2_000_000],encoding='utf-8')
   records.append({'requested':target,'type':type_name,'file':path.name,'returnCode':result.returncode,'bytes':path.stat().st_size})
 (args.out/'type-list.txt').write_text(listed.stdout,encoding='utf-8')
 (args.out/'types.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 found={record['requested'] for record in records if record['returnCode']==0}
 required={'A2.Crypto.BasicCrypto','A2.Crypto.Hash','ReDrive.Config.AppCryptoConfig','ReDrive.Config.AppMsgPackConfig','A2.Http.RequestEncoder'}
 missing=sorted(required-found)
 if missing: raise SystemExit(f'Missing required Taiwan codec types: {missing}')

if __name__=='__main__': main()
