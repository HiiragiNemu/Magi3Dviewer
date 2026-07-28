#!/usr/bin/env python3
from __future__ import annotations
import argparse,json,re,subprocess
from pathlib import Path

TARGETS=(
 ('A2.Crypto','Hash','HashBytes'),('A2.Crypto','Hash','HashString'),('A2.Crypto','Hash','GetSalt'),('A2.Crypto','Hash','GetHashKey'),
 ('A2.Crypto','BasicCrypto','Encrypt'),('A2.Crypto','BasicCrypto','CreateRijndaelManagedForEncrypt'),('A2.Crypto','BasicCrypto','CreateRijndaelManagedForEnCrypt'),('A2.Crypto','BasicCrypto','Decrypt'),
 ('A2.Http','RequestEncoder','EncodeRequetContainer'),('A2.Http','RequestEncoder','EncodeRequestContainer'),
 ('ReDrive.Config','AppCryptoConfig','get_HashKey'),('ReDrive.Config','AppCryptoConfig','get_HashSalt'),('ReDrive.Config','AppCryptoConfig','get_CryptoKey'),('ReDrive.Config','AppCryptoConfig','GetHashAlgorithm'),('ReDrive.Config','AppCryptoConfig','Convert'),
 ('ReDrive.Config','AppMsgPackConfig','GetCryptKey'),
)
NS=re.compile(r'^// Namespace:\s*(.*)$')
TYPE=re.compile(r'^(?:public|private|protected|internal)?\s*(?:sealed\s+|static\s+|abstract\s+)*class\s+([^\s:{]+)')
METHOD=re.compile(r'^\s*// RVA: 0x([0-9A-Fa-f]+).*\n\s*([^\n{]+\([^\n]*\))\s*\{\s*\}',re.M)

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--dump',type=Path,required=True); ap.add_argument('--binary',type=Path,required=True); ap.add_argument('--out',type=Path,required=True); args=ap.parse_args(); args.out.mkdir(parents=True,exist_ok=True)
 text=args.dump.read_text(encoding='utf-8',errors='ignore'); lines=text.splitlines(True)
 namespace=''; typ=''; offset=0; methods=[]; ns_positions=[]; type_positions=[]
 for line in lines:
  stripped=line.strip(); m=NS.match(stripped)
  if m: namespace=m.group(1).strip(); ns_positions.append((offset,namespace))
  t=TYPE.match(stripped)
  if t: typ=t.group(1); type_positions.append((offset,typ))
  offset+=len(line)
 import bisect
 ns_starts=[x[0] for x in ns_positions]; type_starts=[x[0] for x in type_positions]
 for m in METHOD.finditer(text):
  pos=m.start(); ni=bisect.bisect_right(ns_starts,pos)-1; ti=bisect.bisect_right(type_starts,pos)-1
  ns=ns_positions[ni][1] if ni>=0 else ''; tp=type_positions[ti][1] if ti>=0 else ''
  signature=m.group(2).strip(); name=re.search(r'([A-Za-z_][A-Za-z0-9_]*)\s*\(',signature)
  methods.append({'rva':int(m.group(1),16),'namespace':ns,'type':tp,'name':name.group(1) if name else '', 'signature':signature})
 methods.sort(key=lambda x:x['rva'])
 for i,m in enumerate(methods): m['end']=methods[i+1]['rva'] if i+1<len(methods) else m['rva']+4
 selected=[]
 for m in methods:
  if any(m['namespace']==ns and m['type']==tp and m['name']==name for ns,tp,name in TARGETS): selected.append(m)
 if not selected: raise SystemExit('no crypto targets')
 (args.out/'targets.json').write_text(json.dumps(selected,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 for i,m in enumerate(selected):
  safe=re.sub(r'[^A-Za-z0-9_.-]+','_',f"{m['namespace']}.{m['type']}.{m['name']}-{i}")
  path=args.out/f'{safe}.txt'
  result=subprocess.run(['aarch64-linux-gnu-objdump','-d',f'--start-address=0x{m["rva"]:X}',f'--stop-address=0x{m["end"]:X}',str(args.binary)],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,errors='replace',check=False)
  path.write_text(f"{m['signature']}\nRVA 0x{m['rva']:X}-0x{m['end']:X}\n\n{result.stdout}",encoding='utf-8')

if __name__=='__main__': main()
