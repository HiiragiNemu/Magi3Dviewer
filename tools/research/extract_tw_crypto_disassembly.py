#!/usr/bin/env python3
from __future__ import annotations
import argparse,bisect,json,re,subprocess
from pathlib import Path

TARGETS=(
 ('A2.Crypto','Hash','HashBytes'),('A2.Crypto','Hash','HashString'),('A2.Crypto','Hash','GetSalt'),('A2.Crypto','Hash','GetHashKey'),
 ('A2.Crypto','BasicCrypto','Encrypt'),('A2.Crypto','BasicCrypto','CreateRijndaelManagedForEncrypt'),('A2.Crypto','BasicCrypto','CreateRijndaelManagedForEnCrypt'),('A2.Crypto','BasicCrypto','Decrypt'),
 ('A2.Http','RequestEncoder','EncodeRequetContainer'),('A2.Http','RequestEncoder','EncodeRequestContainer'),
 ('A2.Http','BasicAPI','DecodeResponse'),('A2.Http','BasicAPI','DecodeTextResponseAsync'),('A2.Http','BasicAPI','DecodeBinaryResponseAsync'),('A2.Http','BasicAPI','DecodeResponseSync'),
 ('ReDrive.Config','AppCryptoConfig','get_HashKey'),('ReDrive.Config','AppCryptoConfig','get_HashSalt'),('ReDrive.Config','AppCryptoConfig','get_CryptoKey'),('ReDrive.Config','AppCryptoConfig','GetHashAlgorithm'),('ReDrive.Config','AppCryptoConfig','convert'),
 ('ReDrive.Config','AppMsgPackConfig','GetCryptKey'),
)
ALL_TYPE_FRAGMENTS=('PokkeMsgPackAPI','PokkeMsgPackAPIFactory','PokkeAPI','PHPSession','WebRequestExt','JsonProtocol','BasicAPI')
NS=re.compile(r'^// Namespace:\s*(.*)$')
TYPE=re.compile(r'^(?:public|private|protected|internal)?\s*(?:sealed\s+|static\s+|abstract\s+|partial\s+)*(?:class|struct)\s+([^:{]+)')
METHOD=re.compile(r'^\s*// RVA: 0x([0-9A-Fa-f]+).*\n\s*([^\n{]+\([^\n]*\))\s*\{\s*\}',re.M)

def normalize_type(value:str)->str:
 return value.split('//',1)[0].strip().split('<',1)[0].strip()

def safe_name(value:str)->str:
 return re.sub(r'[^A-Za-z0-9_.-]+','_',value)[:220]

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--dump',type=Path,required=True); ap.add_argument('--binary',type=Path,required=True); ap.add_argument('--out',type=Path,required=True); args=ap.parse_args(); args.out.mkdir(parents=True,exist_ok=True)
 text=args.dump.read_text(encoding='utf-8',errors='ignore'); lines=text.splitlines(True)
 offset=0; methods=[]; ns_positions=[]; type_positions=[]
 for line in lines:
  stripped=line.strip(); m=NS.match(stripped)
  if m: ns_positions.append((offset,m.group(1).strip()))
  t=TYPE.match(stripped)
  if t: type_positions.append((offset,t.group(1).strip()))
  offset+=len(line)
 ns_starts=[x[0] for x in ns_positions]; type_starts=[x[0] for x in type_positions]
 for m in METHOD.finditer(text):
  pos=m.start(); ni=bisect.bisect_right(ns_starts,pos)-1; ti=bisect.bisect_right(type_starts,pos)-1
  ns=ns_positions[ni][1] if ni>=0 else ''; raw_type=type_positions[ti][1] if ti>=0 else ''; tp=normalize_type(raw_type)
  signature=m.group(2).strip(); name_match=re.search(r'([A-Za-z_][A-Za-z0-9_]*)\s*\(',signature)
  methods.append({'rva':int(m.group(1),16),'namespace':ns,'type':tp,'rawType':raw_type,'name':name_match.group(1) if name_match else '', 'signature':signature})
 methods.sort(key=lambda x:x['rva'])
 for i,m in enumerate(methods): m['end']=methods[i+1]['rva'] if i+1<len(methods) else m['rva']+4
 selected=[]
 for m in methods:
  exact=any(m['namespace']==ns and m['type']==tp and m['name']==name for ns,tp,name in TARGETS)
  all_type=m['namespace']=='A2.Http' and any(fragment in m['type'] for fragment in ALL_TYPE_FRAGMENTS)
  if exact or all_type: selected.append(m)
 required={(ns,tp,name) for ns,tp,name in TARGETS if ns in {'A2.Crypto','ReDrive.Config'}}
 found={(m['namespace'],m['type'],m['name']) for m in selected}
 missing=sorted(required-found)
 if missing: raise SystemExit(f'missing crypto targets: {missing}')
 (args.out/'targets.json').write_text(json.dumps(selected,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 for i,m in enumerate(selected):
  label=f"{m['namespace']}.{m['type']}.{m['name']}-{i}"
  path=args.out/f'{safe_name(label)}.txt'
  result=subprocess.run(['aarch64-linux-gnu-objdump','-d',f'--start-address=0x{m["rva"]:X}',f'--stop-address=0x{m["end"]:X}',str(args.binary)],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,errors='replace',check=False)
  path.write_text(f"{m['signature']}\nRVA 0x{m['rva']:X}-0x{m['end']:X}\n\n{result.stdout}",encoding='utf-8')
 block_dir=args.out/'type-blocks'; block_dir.mkdir(exist_ok=True); index=[]
 for i,(start,raw_type) in enumerate(type_positions):
  ns_i=bisect.bisect_right(ns_starts,start)-1; ns=ns_positions[ns_i][1] if ns_i>=0 else ''; tp=normalize_type(raw_type)
  keep=(ns=='A2.Http' and any(fragment in tp for fragment in ALL_TYPE_FRAGMENTS)) or (ns=='A2.Crypto' and tp in {'Hash','BasicCrypto'}) or (ns=='ReDrive.Config' and tp in {'AppCryptoConfig','AppMsgPackConfig'})
  if not keep: continue
  stop=type_positions[i+1][0] if i+1<len(type_positions) else len(text); block=text[start:stop][:500_000]
  name=f'{safe_name(ns+"."+tp)}.cs.txt'; (block_dir/name).write_text(block,encoding='utf-8'); index.append({'namespace':ns,'type':tp,'file':name,'bytes':len(block.encode())})
 (block_dir/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__': main()
