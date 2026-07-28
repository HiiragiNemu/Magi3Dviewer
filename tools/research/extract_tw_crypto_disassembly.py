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
GENERIC_TYPE_FRAGMENTS=('PokkeMsgPackAPI','PokkeAPI')
NS=re.compile(r'^// Namespace:\s*(.*)$')
TYPE=re.compile(r'^(?:public|private|protected|internal)?\s*(?:sealed\s+|static\s+|abstract\s+|partial\s+)*(?:class|struct)\s+([^:{]+)')
METHOD=re.compile(r'^\s*// RVA: 0x([0-9A-Fa-f]+).*\n\s*([^\n{]+\([^\n]*\))\s*\{\s*\}',re.M)
DECL=re.compile(r'^\s*((?:public|private|protected|internal)[^\n{]+\([^\n]*\))\s*\{\s*\}',re.M)
GENERIC_RVA=re.compile(r'\|-RVA: 0x([0-9A-Fa-f]+)[^\n]*\n\s*\|-([^\n]+)')

def normalize_type(value:str)->str:
 value=value.split('//',1)[0].strip()
 # Strip only the trailing generic argument list. Do not truncate compiler names
 # such as ``<>c__DisplayClass8_0<TReq, TRes>`` at their leading ``<>``.
 value=re.sub(r'<[A-Za-z_][^<>]*>$','',value).strip()
 return value

def safe_name(value:str)->str:
 return re.sub(r'[^A-Za-z0-9_.-]+','_',value)[:220]

def method_name(signature:str)->str:
 match=re.search(r'([A-Za-z_<>][A-Za-z0-9_<>]*)\s*\(',signature)
 return match.group(1) if match else 'unknown'

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
  signature=m.group(2).strip()
  methods.append({'rva':int(m.group(1),16),'namespace':ns,'type':tp,'rawType':raw_type,'name':method_name(signature),'signature':signature,'source':'direct'})
 for i,(start,raw_type) in enumerate(type_positions):
  ns_i=bisect.bisect_right(ns_starts,start)-1; ns=ns_positions[ns_i][1] if ns_i>=0 else ''; tp=normalize_type(raw_type)
  if ns!='A2.Http' or not any(fragment in tp for fragment in GENERIC_TYPE_FRAGMENTS): continue
  stop=type_positions[i+1][0] if i+1<len(type_positions) else len(text); block=text[start:stop]; declarations=list(DECL.finditer(block))
  for di,decl in enumerate(declarations):
   signature=decl.group(1).strip(); section_start=decl.end(); section_stop=declarations[di+1].start() if di+1<len(declarations) else len(block); section=block[section_start:section_stop]
   object_impls=[]; shared_impls=[]
   for gm in GENERIC_RVA.finditer(section):
    item={'rva':int(gm.group(1),16),'namespace':ns,'type':tp,'rawType':raw_type,'name':method_name(signature),'signature':signature,'implementation':gm.group(2).strip(),'source':'generic'}
    if '<object, object>' in item['implementation']: object_impls.append(item)
    else: shared_impls.append(item)
   methods.extend(object_impls if object_impls else shared_impls[:1])
 by_rva={}
 for item in methods: by_rva.setdefault(item['rva'],item)
 methods=[by_rva[key] for key in sorted(by_rva)]
 for i,m in enumerate(methods): m['end']=methods[i+1]['rva'] if i+1<len(methods) else m['rva']+0x400
 selected=[]
 for m in methods:
  exact=any(m['namespace']==ns and m['type']==tp and m['name']==name for ns,tp,name in TARGETS)
  all_type=m['namespace']=='A2.Http' and any(fragment in m['type'] for fragment in ALL_TYPE_FRAGMENTS)
  if exact or all_type: selected.append(m)
 found={(m['namespace'],m['type'],m['name']) for m in selected}
 mandatory={
  ('A2.Crypto','Hash','HashBytes'),('A2.Crypto','Hash','HashString'),('A2.Crypto','Hash','GetSalt'),('A2.Crypto','Hash','GetHashKey'),
  ('A2.Crypto','BasicCrypto','Encrypt'),('A2.Crypto','BasicCrypto','Decrypt'),
  ('ReDrive.Config','AppCryptoConfig','get_HashKey'),('ReDrive.Config','AppCryptoConfig','get_HashSalt'),('ReDrive.Config','AppCryptoConfig','get_CryptoKey'),('ReDrive.Config','AppCryptoConfig','GetHashAlgorithm'),('ReDrive.Config','AppCryptoConfig','convert'),
  ('ReDrive.Config','AppMsgPackConfig','GetCryptKey'),
 }
 missing=sorted(mandatory-found)
 helper_present=any(item in found for item in {
  ('A2.Crypto','BasicCrypto','CreateRijndaelManagedForEncrypt'),
  ('A2.Crypto','BasicCrypto','CreateRijndaelManagedForEnCrypt'),
 })
 closure_present=any('DisplayClass8_0' in m['type'] for m in selected)
 diagnostic={'methodCount':len(methods),'selectedCount':len(selected),'missingMandatory':missing,'rijndaelHelperPresent':helper_present,'responseClosurePresent':closure_present}
 (args.out/'selection-diagnostic.json').write_text(json.dumps(diagnostic,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 if missing or not helper_present or not closure_present: raise SystemExit(f'crypto selection incomplete: {diagnostic}')
 (args.out/'targets.json').write_text(json.dumps(selected,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 for i,m in enumerate(selected):
  label=f"{m['namespace']}.{m['type']}.{m['name']}-{i}"; path=args.out/f'{safe_name(label)}.txt'
  result=subprocess.run(['aarch64-linux-gnu-objdump','-d',f'--start-address=0x{m["rva"]:X}',f'--stop-address=0x{m["end"]:X}',str(args.binary)],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,errors='replace',check=False)
  path.write_text(f"{m['signature']}\nimplementation={m.get('implementation','')}\nsource={m['source']}\nRVA 0x{m['rva']:X}-0x{m['end']:X}\n\n{result.stdout}",encoding='utf-8')
 block_dir=args.out/'type-blocks'; block_dir.mkdir(exist_ok=True); index=[]
 for i,(start,raw_type) in enumerate(type_positions):
  ns_i=bisect.bisect_right(ns_starts,start)-1; ns=ns_positions[ns_i][1] if ns_i>=0 else ''; tp=normalize_type(raw_type)
  keep=(ns=='A2.Http' and any(fragment in tp for fragment in ALL_TYPE_FRAGMENTS)) or (ns=='A2.Crypto' and tp in {'Hash','BasicCrypto'}) or (ns=='ReDrive.Config' and tp in {'AppCryptoConfig','AppMsgPackConfig'})
  if not keep: continue
  stop=type_positions[i+1][0] if i+1<len(type_positions) else len(text); block=text[start:stop][:700_000]
  name=f'{safe_name(ns+"."+tp)}.cs.txt'; (block_dir/name).write_text(block,encoding='utf-8'); index.append({'namespace':ns,'type':tp,'file':name,'bytes':len(block.encode())})
 (block_dir/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__': main()
