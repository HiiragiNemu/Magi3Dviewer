"""Read-only native atlas/UV census; pixel differences alone are NOT atlas mismatches.
Exports candidate comparison images outside the application. No runtime asset is edited.
"""
from pathlib import Path
import json,hashlib,warnings,concurrent.futures,argparse
import UnityPy,numpy as np
from PIL import Image
from UnityPy.helpers.MeshHelper import MeshHandler
warnings.filterwarnings('ignore');UnityPy.config.FALLBACK_UNITY_VERSION='2022.3.62f2'
ROOT=Path.cwd();OUT=ROOT/'artifacts/atlas-audit';SRC=Path(r'D:\magia\Madoka Magica Magia Exedra Steam JP\AssetBundles')
def sha(b):return hashlib.sha256(b).hexdigest()
def run(row):
 model=row['model'];path=Path(row.get('sourceBundle',SRC/'battle/character'/model));result={'model':model,'fbxSha256':row['fbxSha256'],'bundle':str(path),'meshes':[],'textures':[]}
 if not path.is_file():result['status']='native-battle-source-absent';return result
 try:
  result['bundleSha256']=sha(path.read_bytes());env=UnityPy.load(str(path));native_meshes=[]
  for obj in env.objects:
   if obj.type.name=='Mesh':
    m=obj.read();h=MeshHandler(m);h.process()
    if not getattr(h,'m_UV0',None):continue
    uv=np.asarray(h.m_UV0,dtype='<f4');idx=np.asarray(h.m_IndexBuffer,dtype=np.int64);exp=uv[idx,:2]
    native_meshes.append((m.m_Name,obj.path_id,exp))
  for fm in row['meshes']:
   uv=np.frombuffer((OUT/'fbx'/fm['file']).read_bytes(),dtype='<f4').reshape((-1,2));matches=[]
   for name,pid,nu in native_meshes:
    if len(nu)!=len(uv):continue
    for winding,arr in [('native',nu),('reflected',nu.reshape((-1,3,2))[:,[2,1,0],:].reshape((-1,2)))]:
     error=float(np.max(np.abs(uv-arr)));matches.append({'nativeName':name,'meshPathId':str(pid),'winding':winding,'maxUVError':round(error,8)})
   best=min(matches,key=lambda x:x['maxUVError']) if matches else None
   result['meshes'].append({**{k:v for k,v in fm.items() if k!='file'},'match':best,'uvMatches':bool(best and best['maxUVError']<1e-5)})
  local=ROOT/row.get('assetDirectory',str(Path('magia-exedra-character-three/models')/model))
  for obj in env.objects:
   if obj.type.name!='Texture2D':continue
   t=obj.read();file=local/(t.m_Name+'.png')
   if not file.is_file():continue
   # Pillow BC6 requires RGB, unlike UnityPy 1.25's RGBA dispatch.
   native=(Image.frombytes('RGB',(t.m_Width,t.m_Height),bytes(t.get_image_data()),'bcn',6).transpose(Image.Transpose.FLIP_TOP_BOTTOM) if int(t.m_TextureFormat)==24 else t.image).convert('RGBA')
   current=Image.open(file).convert('RGBA');a=np.asarray(current);b=np.asarray(native)
   sa=np.asarray(current.resize((128,128),Image.Resampling.BOX)).astype(float);sb=np.asarray(native.resize((128,128),Image.Resampling.BOX)).astype(float);delta=np.abs(sa-sb)
   r={'name':t.m_Name,'pathId':str(obj.path_id),'format':int(t.m_TextureFormat),'size':list(current.size),'nativeSize':list(native.size),'fileSha256':sha(file.read_bytes()),'pixelSha256':sha(a.tobytes()),'nativePixelSha256':sha(b.tobytes()),'mae128':round(float(delta.mean()),4),'over32':round(float((np.max(delta,axis=2)>32).mean()),5)}
   # Coarse texture differences identify candidates; native material/UV joins and
   # visual layout comparison decide whether this is an actual atlas mismatch.
   r['candidate']=r['mae128']>3 or r['over32']>.04 or current.size!=native.size
   if r['candidate']:
    d=OUT/'candidates'/model;d.mkdir(parents=True,exist_ok=True);native.save(d/(t.m_Name+'-native.png'))
    side=Image.new('RGB',(768,384));side.paste(current.convert('RGB').resize((384,384)),(0,0));side.paste(native.convert('RGB').resize((384,384)),(384,0));side.save(d/(t.m_Name+'-compare.jpg'),quality=90)
   result['textures'].append(r)
  result['status']='audited';(OUT/'rows').mkdir(exist_ok=True);(OUT/'rows'/(model+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');return result
 except Exception as e:result['status']='error';result['error']=repr(e);return result
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--index',default=str(OUT/'fbx/index.json'));parser.add_argument('--output',default=str(OUT/'census.json'));args=parser.parse_args()
 rows=json.loads(Path(args.index).read_text(encoding='utf8'));results=[]
 with concurrent.futures.ProcessPoolExecutor(max_workers=4) as pool:
  for r in pool.map(run,rows):
   results.append(r);print(r['model'],r['status'],'textures',len(r['textures']),'candidates',[t['name'] for t in r['textures'] if t['candidate']],flush=True)
 report={'schema':'magius.native-atlas-census.v1','baseline':'0ea625a','policy':'read-only;candidate pixel differences are not automatically classified as atlas mismatches','models':results}
 Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print('TOTAL',len(results),'AUDITED',sum(r['status']=='audited' for r in results),'TEXTURES',sum(len(r['textures']) for r in results),flush=True)
