#!/usr/bin/env python3
"""Verify pure native 2D gallery assets against existing immutable release pixels.

This is an authority-fixture audit, not a dependency of the website build.
No generic image-plane product is enabled merely because it contains a texture.
"""
from __future__ import annotations
import argparse, hashlib, io, json, time, urllib.request, zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import UnityPy
from PIL import Image


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser=argparse.ArgumentParser()
    parser.add_argument('--source-root',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path('artifacts/scene-completeness-20261003/gallery-audit'))
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    UnityPy.config.FALLBACK_UNITY_VERSION='2022.3.62f2'
    shard=Path('public/stages/catalogs/official-gallery-diorama-original.v1.json')
    document=json.loads(shard.read_text(encoding='utf-8-sig'))
    entries=document['stages']
    products=json.loads(Path('public/catalogs/runtime-product-delivery.v1.json').read_text(encoding='utf-8-sig'))['entries']

    def audit(entry: dict) -> dict:
        source=args.source_root/entry['assetBundleName']
        raw=source.read_bytes();env=UnityPy.load(raw);objects=list(env.objects)
        counts=dict(Counter(o.type.name for o in objects))
        if set(counts)-{'Texture2D','Sprite','AssetBundle'} or counts.get('Sprite')!=1 or counts.get('Texture2D')!=1:
            raise ValueError('Not a single native image background: '+str(counts))
        sprite=next(o for o in objects if o.type.name=='Sprite')
        texture=next(o for o in objects if o.type.name=='Texture2D')
        native=sprite.read().image.convert('RGBA')
        native_hash=sha(native.tobytes())
        root='/stages/official/'+entry['id']+'/'
        product=next(p for p in products if p['rootPath']==root)
        cache=args.output/(entry['id']+'.zip')
        if not cache.exists():
            req=urllib.request.Request(product['packUrl'],headers={'Origin':'https://magius3dviewer.pages.dev','Referer':'https://magius3dviewer.pages.dev/','User-Agent':'MagiusSceneAuthorityAudit/1.0'})
            for attempt in range(3):
                try:
                    payload=urllib.request.urlopen(req,timeout=50).read()
                    if len(payload)!=product['packedBytes']:raise ValueError('Archive size mismatch')
                    cache.write_bytes(payload);break
                except Exception:
                    if attempt==2:raise
                    time.sleep(1+attempt)
        archive_bytes=cache.read_bytes()
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            manifest=json.loads(archive.read('scene-product.json'))
            if manifest['stableKey']!=entry['stableKey'] or manifest['stageId']!=entry['id']:
                raise ValueError('Release identity mismatch')
            images=manifest['images']
            if len(images)!=1:raise ValueError('Ambiguous release images')
            image=images[0]
            if image['sourceType']!='Sprite' or str(image['pathId'])!=str(sprite.path_id):
                raise ValueError('Sprite PPtr mismatch')
            filename=image['file']
            if '/' in filename or '\\' in filename or not filename.lower().endswith('.png'):
                raise ValueError('Unsafe image member')
            data=archive.read(filename);released=Image.open(io.BytesIO(data)).convert('RGBA')
            if released.size!=native.size or sha(released.tobytes())!=native_hash:
                raise ValueError('Release image differs from the exact native Sprite pixels')
        return {'id':entry['id'],'sourceBundle':entry['assetBundleName'],'sourceBundleSha256':sha(raw),'sourceTypes':counts,
            'sourceRegion':'steam-jp','texturePathId':str(texture.path_id),'spritePathId':str(sprite.path_id),
            'containerPaths':list(env.container),'width':native.width,'height':native.height,'pixelSha256':native_hash,
            'fileSha256':sha(data),'byteLength':len(data),'url':'.'+root+filename,
            'releaseTag':product['releaseTag'],'assetName':product['assetName'],'archiveSha256':sha(archive_bytes),
            'status':'verified-native-2d-image','notA3DReconstruction':True}

    results=[];failures=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures={pool.submit(audit,e):e for e in entries}
        for future in as_completed(futures):
            entry=futures[future]
            try:
                row=future.result();results.append(row);print('VERIFIED',row['id'],flush=True)
            except Exception as exc:
                failures.append({'id':entry['id'],'error':str(exc)});print('FAILED',entry['id'],str(exc),flush=True)
            (args.output/'audit.json').write_text(json.dumps({'schema':'magius.native-gallery-image-audit.v1','total':len(entries),'verified':sorted(results,key=lambda x:x['id']),'failures':failures},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    if failures:return 1
    if args.apply:
        by_id={r['id']:r for r in results}
        for entry in entries:
            r=by_id[entry['id']]
            entry['type']='image';entry['url']=r['url']
            entry['nativeImage']={'schema':'magius.native-image-background.v1','sourceType':'Sprite','sourceRegion':r['sourceRegion'],
                'sourceBundle':r['sourceBundle'],'spritePathId':r['spritePathId'],'texturePathId':r['texturePathId'],
                'width':r['width'],'height':r['height'],'byteLength':r['byteLength'],'sha256':r['fileSha256'],'pixelSha256':r['pixelSha256']}
            entry['dynamic']={'expected':False,'status':'static','evidence':['Native bundle contains only one Texture2D and one Sprite, no 3D scene or omitted components.',
                'Existing release PNG matches the native Steam Sprite pixel-for-pixel; see native-gallery audit.',
                'Displayed as an aspect-preserving screen-space 2D backdrop, not a reconstructed 3D scene.']}
        shard.write_text(json.dumps(document,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'total':len(entries),'verified':len(results),'failed':len(failures),'applied':args.apply}),flush=True)
    return 0

if __name__=='__main__':raise SystemExit(main())
