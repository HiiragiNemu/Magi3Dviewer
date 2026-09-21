"""Make an absent native UV0 explicit in FBX, after exact geometry/native joins.

This is an offline export-normalization step, not a runtime validation bypass.
Only Meshes with a serialized absent UV0 AND decoded absence qualify. Every
exported control point, triangle and material slot must match the native mesh.
Existing UV channels and all original FBX property payloads remain untouched.
"""
from __future__ import annotations
import argparse,gzip,hashlib,json,struct,zlib,warnings
from pathlib import Path
from dataclasses import dataclass

@dataclass
class Node:
 name: str
 props: list
 rawprops: bytes
 children: list
 tail: bytes=b''

class Fbx:
 def __init__(self,data):
  if not data.startswith(b'Kaydara FBX Binary  \0\x1a\0'):raise ValueError('Expected binary FBX')
  self.data=data;self.version=struct.unpack_from('<I',data,23)[0];self.fmt='<QQQB' if self.version>=7500 else '<IIIB';self.ns=25 if self.version>=7500 else 13;self.roots=[];p=27
  while data[p:p+self.ns]!=bytes(self.ns):
   n,p=self.node(p);self.roots.append(n)
  self.footer=data[p:]
 def node(self,p):
  end,count,propbytes,namelen=struct.unpack_from(self.fmt,self.data,p);p+=self.ns;name=self.data[p:p+namelen].decode('utf8');p+=namelen;start=p;props=[]
  for _ in range(count):
   kind=chr(self.data[p]);p+=1
   if kind in 'YCIFDL':
    fmt={'Y':'h','C':'?','I':'i','F':'f','D':'d','L':'q'}[kind];value=struct.unpack_from('<'+fmt,self.data,p)[0];p+=struct.calcsize(fmt)
   elif kind in 'SR':
    size=struct.unpack_from('<I',self.data,p)[0];p+=4;value=self.data[p:p+size];p+=size
    if kind=='S':value=value.decode('utf8')
   elif kind in 'fdilbc':
    size,encoding,length=struct.unpack_from('<III',self.data,p);p+=12;value={'kind':kind,'size':size,'encoding':encoding,'bytes':self.data[p:p+length]};p+=length
   else:raise ValueError(f'Unknown FBX property {kind}')
   props.append(value)
  if p-start!=propbytes:raise ValueError('FBX property length mismatch')
  raw=self.data[start:p];children=[]
  while p<end and self.data[p:p+self.ns]!=bytes(self.ns):
   child,p=self.node(p);children.append(child)
  if end<p or end>len(self.data):raise ValueError('FBX node length mismatch')
  return Node(name,props,raw,children,self.data[p:end]),end
 def encode(self):
  def node(n,start):
   name=n.name.encode('utf8');head=self.ns+len(name)+len(n.rawprops);body=bytearray()
   for child in n.children:body.extend(node(child,start+head+len(body)))
   body.extend(n.tail);end=start+head+len(body)
   return struct.pack(self.fmt,end,len(n.props),len(n.rawprops),len(name))+name+n.rawprops+body
  result=bytearray(self.data[:27])
  for n in self.roots:result.extend(node(n,len(result)))
  result.extend(self.footer);return bytes(result)

def child(n,name):return next((x for x in n.children if x.name==name),None)
def clean(name):return name.split('\0',1)[0].removeprefix('Model::').removeprefix('Geometry::').removeprefix('Material::')
def values(p):
 raw=zlib.decompress(p['bytes']) if p['encoding']==1 else p['bytes'];return struct.unpack('<'+str(p['size'])+p['kind'],raw)
def scalar(name,value):
 if isinstance(value,str):b=value.encode('utf8');raw=b'S'+struct.pack('<I',len(b))+b
 else:raw=b'I'+struct.pack('<i',value)
 return Node(name,[value],raw,[])
def uv_node(count,ns):
 raw=bytes(count*2*8);packed=zlib.compress(raw);prop=b'd'+struct.pack('<III',count*2,1,len(packed))+packed
 return Node('LayerElementUV',[0],b'I'+struct.pack('<i',0),[scalar('Version',101),scalar('Name','UV0'),scalar('MappingInformationType','ByVertice'),scalar('ReferenceInformationType','Direct'),Node('UV',[{'kind':'d','size':count*2,'encoding':1,'bytes':packed}],prop,[])],bytes(ns))

def restore(source_fbx:Path,source_bundle:Path,output:Path,evidence:Path,unity_fallback='2022.3.62f2'):
 import UnityPy
 from UnityPy.helpers.MeshHelper import MeshHandler
 UnityPy.config.FALLBACK_UNITY_VERSION=unity_fallback
 warnings.filterwarnings('ignore',message='No valid Unity version found')
 encoded=source_fbx.read_bytes();compressed=encoded[:2]==b'\x1f\x8b';raw=gzip.decompress(encoded) if compressed else encoded;fbx=Fbx(raw)
 # Lossless parser round trip is a precondition to any transformation.
 if fbx.encode()!=raw:raise ValueError('FBX codec is not byte-exact for this source')
 objects=child(Node('',[],b'',fbx.roots),'Objects');connections=child(Node('',[],b'',fbx.roots),'Connections')
 byid={n.props[0]:n for n in objects.children if n.props and isinstance(n.props[0],int)}
 parents={};children={}
 for c in connections.children:
  if c.name=='C' and c.props[0]=='OO':parents.setdefault(c.props[1],[]).append(c.props[2]);children.setdefault(c.props[2],[]).append(c.props[1])
 def model_path(mid):
  out=[];seen=set()
  while mid in byid and byid[mid].name=='Model':
   if mid in seen:raise ValueError('FBX hierarchy cycle')
   seen.add(mid);out.append(clean(byid[mid].props[1]));ps=[p for p in parents.get(mid,[]) if p in byid and byid[p].name=='Model']
   if len(ps)>1:raise ValueError('Ambiguous FBX parent')
   mid=ps[0] if ps else 0
  return '/'.join(reversed(out))
 env=UnityPy.load(str(source_bundle));native={o.path_id:o for o in env.objects};gos={};transforms={};transform_by_go={}
 for o in env.objects:
  if o.type.name=='GameObject':gos[o.path_id]=o.read_typetree()
  elif o.type.name=='Transform':t=o.read_typetree();transforms[o.path_id]=t;transform_by_go[t['m_GameObject']['m_PathID']]=t
 def native_path(gid):
  names=[];seen=set()
  while gid in gos:
   if gid in seen:raise ValueError('Native hierarchy cycle')
   seen.add(gid);names.append(gos[gid]['m_Name']);father=transform_by_go[gid]['m_Father']['m_PathID'];gid=transforms[father]['m_GameObject']['m_PathID'] if father in transforms else 0
  return '/'.join(reversed(names))
 paths={}
 for gid in gos:paths.setdefault(native_path(gid),[]).append(gid)
 changes=[]
 for geo in objects.children:
  if geo.name!='Geometry' or len(geo.props)<3 or geo.props[2]!='Mesh':continue
  verts=child(geo,'Vertices');indices=child(geo,'PolygonVertexIndex')
  if not verts or not verts.props[0]['size']:continue
  if any(n.name=='LayerElementUV' and n.props==[0] for n in geo.children):continue
  model_ids=[p for p in parents.get(geo.props[0],[]) if p in byid and byid[p].name=='Model']
  if len(model_ids)!=1:raise ValueError('Missing-UV geometry has ambiguous model attachment')
  mid=model_ids[0];path=model_path(mid);gids=paths.get(path,[])
  if len(gids)!=1:raise ValueError(f'Native GameObject join is not unique: {path}')
  gid=gids[0];components=[]
  for c in gos[gid]['m_Component']:
   pp=c['component']
   if pp['m_FileID']!=0:raise ValueError('External component unresolved')
   ob=native[pp['m_PathID']];components.append((ob,ob.read_typetree()))
  filters=[x for x in components if x[0].type.name=='MeshFilter'];renderers=[x for x in components if x[0].type.name=='MeshRenderer']
  if len(filters)!=1 or len(renderers)!=1:raise ValueError(f'Expected exact MeshFilter/MeshRenderer pair: {path}')
  ptr=filters[0][1]['m_Mesh']
  if ptr['m_FileID']!=0:raise ValueError('External Mesh requires a separately resolved exact bundle')
  reader=native[ptr['m_PathID']];tree=reader.read_typetree();channels=tree['m_VertexData']['m_Channels']
  if len(channels)<=4 or (int(channels[4]['dimension'])&15)!=0 or tree['m_CompressedMesh']['m_UV']['m_NumItems']!=0:raise ValueError(f'Native UV0 is present or compressed layout is ambiguous: {path}')
  handler=MeshHandler(reader.read());handler.process()
  if handler.m_UV0:raise ValueError(f'Decoded native UV0 is present: {path}')
  actual=list(values(verts.props[0]));expected=[c for xyz in handler.m_Vertices for c in (-xyz[0],xyz[1],xyz[2])]
  if actual!=expected:raise ValueError(f'FBX/native reflected control points differ: {path}')
  actual_indices=list(values(indices.props[0]));expected_indices=[]
  for sub in handler.get_triangles():
   for a,b,c in sub:expected_indices.extend([c,b,-a-1])
  if actual_indices!=expected_indices:raise ValueError(f'FBX/native triangle topology differs: {path}')
  native_mats=[]
  for pp in renderers[0][1]['m_Materials']:
   if pp['m_FileID']!=0:raise ValueError('External material requires an exact closure join')
   native_mats.append(native[pp['m_PathID']].read_typetree()['m_Name'])
  exported_mats=[clean(byid[c].props[1]) for c in children.get(mid,[]) if c in byid and byid[c].name=='Material']
  if exported_mats!=native_mats:raise ValueError(f'FBX/native material slots differ: {path}')
  layer=next((x for x in geo.children if x.name=='Layer' and x.props==[0]),None)
  if layer is None:raise ValueError('FBX Layer0 is absent')
  original_children=[{'name':x.name,'sha256':hashlib.sha256(x.rawprops).hexdigest()} for x in geo.children]
  geo.children.append(uv_node(handler.m_VertexCount,fbx.ns));layer.children.append(Node('LayerElement',[],b'',[scalar('Type','LayerElementUV'),scalar('TypedIndex',0)],bytes(fbx.ns)))
  changes.append({'hierarchyPath':path,'fbxGeometryID':str(geo.props[0]),'sourceCab':reader.assets_file.name,'sourceMeshPathID':str(reader.path_id),'sourceRendererPathID':str(renderers[0][0].path_id),'sourceMeshVertexCount':handler.m_VertexCount,'indexCount':len(actual_indices),'nativeUv0Dimension':int(channels[4]['dimension'])&15,'nativeUv1Dimension':int(channels[5]['dimension'])&15,'decodedNativeUv0':'ABSENT','defaultValue':[0,0],'defaultAuthority':'https://docs.unity3d.com/2022.3/Documentation/Manual/SL-VertexProgramInputs.html','geometryAndMaterialJoin':'EXACT_REFLECT_X_CONTROL_POINTS_CBA_TRIANGLES_MATERIAL_SLOTS','materialNames':native_mats,'originalGeometryPropertyPayloads':original_children})
 modified=fbx.encode();output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(encoded if not changes else (gzip.compress(modified,mtime=0) if compressed else modified))
 result={'status':'PASS','changedMeshCount':len(changes),'sourceBundle':str(source_bundle),'sourceBundleSha256':hashlib.sha256(source_bundle.read_bytes()).hexdigest(),'serializedPlatform':sorted({int(o.assets_file.target_platform) for o in env.objects}),'sourceFbxSha256':hashlib.sha256(encoded).hexdigest(),'modifiedFbxSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'losslessOriginalCodecRoundTrip':True,'changes':changes}
 evidence.parent.mkdir(parents=True,exist_ok=True);evidence.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf-8');return result

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--fbx',type=Path,required=True);ap.add_argument('--bundle',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);ap.add_argument('--evidence',type=Path,required=True);a=ap.parse_args();r=restore(a.fbx,a.bundle,a.output,a.evidence);print(f"NATIVE_ABSENT_UV0_RESTORE PASS changedMeshes={r['changedMeshCount']}")
