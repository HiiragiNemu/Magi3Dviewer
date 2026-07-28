#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

PATTERNS = (
    r"(^|\.)AppUrl$", r"(^|\.)AppUrlData$", r"(^|\.)AppLocalizeSettings$",
    r"(^|\.)AppResourceSettings$", r"(^|\.)AppSettings$", r"(^|\.)AppPokkeConfig$",
    r"(^|\.)AppReqBase$", r"(^|\.)ReDriveMsgPackApiFactory$", r"(^|\.)APISigning$",
    r"(^|\.)ResourceApi$", r"(^|\.)ResourceRemoteUrl$", r"(^|\.)ResourceDownloader$",
    r"(^|\.)ResourceConfigData$", r"(^|\.)ResourceConfigModel$",
    r"(^|\.)ResourceGcsSignedUrlData$", r"(^|\.)ResourceGcsSignedUrlModel$",
    r"(^|\.)PokkeMsgPackAPIFactory$", r"(^|\.)PokkeMsgPackAPI$", r"(^|\.)PokkeMsgPackAPI`2$",
    r"(^|\.)PokkeReqContainer$", r"(^|\.)PokkeUserInfo$", r"(^|\.)PokkeDefaultConfig$",
    r"(^|\.)Pokke.*(Encode|Decode|Encoder|Decoder|Crypt|Cipher).*$",
    r"(^|\.)LoginAPI$", r"(^|\.)LoginApi$", r"(^|\.)LoginApi\.Login$",
    r"(^|\.)LoginApi\.Login\.Request$", r"(^|\.)LoginApi\.Login\.Response$",
    r"(^|\.)TW_ApiHelper$", r"(^|\.)Title.*Login.*$", r"(^|\.)Login.*UseCase.*$",
    r"(^|\.)Login.*Sequence.*$", r"(^|\.)LoginReq$", r"(^|\.)LoginRes$",
    r"(^|\.)SignatureProvider$", r"(^|\.)LoginHelper$", r"(^|\.)SystemMonitor$",
    r"(^|\.)TW_GameLibSns$", r"(^|\.)Initializer$", r"(^|\.)WGL.*NativeAPI$",
    r"(^|\.)ProductionDomainConfig$", r"(^|\.)StagingDomainConfig$",
    r"(^|\.)ReviewDomainConfig$", r"(^|\.)QaDomainConfig$",
    r"(^|\.)JudgementDomainConfig$", r"(^|\.)DevelopmentDomainConfig$",
    r"(^|\.)IAppDomainConfig$",
)


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,errors="replace",check=False,timeout=180)


def main() -> None:
    parser=argparse.ArgumentParser(); parser.add_argument("--ilspy",type=Path,required=True); parser.add_argument("--assembly",type=Path,required=True); parser.add_argument("--out",type=Path,required=True); args=parser.parse_args(); args.out.mkdir(parents=True,exist_ok=True)
    listed=run([str(args.ilspy),"-l","c",str(args.assembly)])
    (args.out/"type-list.txt").write_text(listed.stdout,encoding="utf-8")
    if listed.returncode: raise SystemExit(f"ilspy type listing failed: {listed.returncode}")
    type_names=[]
    for line in listed.stdout.splitlines():
        value=re.sub(r"^(Class|Struct|Interface|Enum)\s+","",line.strip())
        if value and any(re.search(pattern,value) for pattern in PATTERNS): type_names.append(value)
    type_names=list(dict.fromkeys(type_names))[:220]
    records=[]
    for index,type_name in enumerate(type_names):
        safe=re.sub(r"[^A-Za-z0-9_.-]+","_",type_name)[:180]; target=args.out/f"{index:03d}-{safe}.cs"
        result=run([str(args.ilspy),"-t",type_name,str(args.assembly)]); text=result.stdout
        if len(text)>1_500_000: text=text[:1_500_000]+"\n// truncated\n"
        target.write_text(text,encoding="utf-8")
        records.append({"type":type_name,"file":target.name,"returnCode":result.returncode,"bytes":len(text.encode())})
    (args.out/"selected-types.json").write_text(json.dumps(records,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    if not records: raise SystemExit("no selected Taiwan protocol types found")

if __name__=="__main__": main()
