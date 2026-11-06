// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace LogViewer {
 internal sealed class DiskSchema {
  public int id,typeId,length,timeOffset;public char timeType; public string name,format; public string[] columns; public long count;
 }
 internal sealed class DiskTable { public string Name,Index;public long Count;public double LastTime=Double.NegativeInfinity;public bool Ordered=true;public BinaryWriter Writer; }
 internal sealed class DiskLog {
  public string Id,Name,Source,Root,AnalysisId,Catalog;public long Size,Packets;public bool Ready,Text;public FileStream SourceHandle;
  public readonly List<DiskSchema> Schemas=new List<DiskSchema>();
  public readonly Dictionary<string,DiskTable> Tables=new Dictionary<string,DiskTable>();
 }
 [ComVisible(true),ClassInterface(ClassInterfaceType.AutoDual)]
 public sealed class DiskLogBridge:IDisposable {
  readonly string root,endpoint; readonly object gate=new object();readonly IWin32Window owner;
  int plotGeneration;
  public void CancelPlotQuery(){System.Threading.Interlocked.Increment(ref plotGeneration);}
  sealed class CsvExport {public string Target,Temporary;public StreamWriter Writer;}
  readonly Dictionary<string,CsvExport> exports=new Dictionary<string,CsvExport>();
  readonly Dictionary<string,DiskLog> logs=new Dictionary<string,DiskLog>();
  readonly Dictionary<string,DiskLog> analysisStores=new Dictionary<string,DiskLog>();
  MemoryMappedFile mapped;MemoryMappedViewAccessor view;string mappedId;long viewStart,viewLength;
  const int WindowBytes=8*1024*1024;
  internal static JavaScriptSerializer Json(){return new JavaScriptSerializer{MaxJsonLength=32*1024*1024,RecursionLimit=128};}
  internal DiskLogBridge(string directory,string apiEndpoint,IWin32Window window=null){root=Path.GetFullPath(directory);Directory.CreateDirectory(root);endpoint=apiEndpoint;owner=window;}
  public string Endpoint(){return endpoint;}
  internal object[] Register(IEnumerable<string> files){lock(gate){return files.Select(source=>{
   var info=new FileInfo(source);if(!info.Exists)throw new IOException("선택한 파일이 없습니다.");
   string id=Guid.NewGuid().ToString("N"),folder=Path.Combine(root,id);Directory.CreateDirectory(folder);
   var log=new DiskLog{Id=id,Name=info.Name,Source=info.FullName,Size=info.Length,Root=folder,Text=info.Extension.Equals(".log",StringComparison.OrdinalIgnoreCase)};
   logs.Add(id,log);return (object)new {nativeId=id,name=log.Name,size=log.Size};
  }).ToArray();}}
  DiskLog Log(string id){DiskLog log;if(!logs.TryGetValue(id,out log))throw new IOException("이 창에서 첨부한 로그가 아닙니다.");return log;}
  DiskLog Store(string id){DiskLog store;return analysisStores.TryGetValue(id,out store)?store:Log(id);}
  public string BeginAnalysis(string id){lock(gate){var log=Log(id);string token=Guid.NewGuid().ToString("N"),folder=Path.Combine(log.Root,"analysis-"+token);Directory.CreateDirectory(folder);analysisStores.Add(token,new DiskLog{Id=token,Source=id,Root=folder});return token;}}
  public void CommitAnalysis(string id,string token){lock(gate){var log=Log(id);DiskLog store;if(!analysisStores.TryGetValue(token,out store)||store.Source!=id)throw new IOException("분석 저장소가 일치하지 않습니다.");if(!File.Exists(Path.Combine(store.Root,"analysis.json")))throw new IOException("분석 결과 저장이 완료되지 않았습니다.");string previous=log.AnalysisId;log.AnalysisId=token;foreach(string old in analysisStores.Where(pair=>pair.Value.Source==id&&pair.Key!=token&&pair.Key!=previous).Select(pair=>pair.Key).ToArray()){Directory.Delete(analysisStores[old].Root,true);analysisStores.Remove(old);}}}
  public void AbortAnalysis(string token){lock(gate){DiskLog store;if(!analysisStores.TryGetValue(token,out store))return;if(Log(store.Source).AnalysisId==token)return;analysisStores.Remove(token);Directory.Delete(store.Root,true);}}
  internal string Import(string id,Action<double,string> progress){lock(gate){
   var log=Log(id);if(log.Ready)return Metadata(log);
   try{
    var before=new FileInfo(log.Source);long stamp=before.LastWriteTimeUtc.Ticks;
    // Keep only a read handle; deny writes/deletion while this log is attached.
    log.SourceHandle=new FileStream(log.Source,FileMode.Open,FileAccess.Read,FileShare.Read,4096,FileOptions.RandomAccess);
    if(log.SourceHandle.Length!=log.Size)throw new IOException("선택한 뒤 원본 크기가 변경되었습니다. 다시 첨부하세요.");
    if(log.Text)IndexText(log,progress);else IndexBinary(log,progress);
    var after=new FileInfo(log.Source);if(after.Length!=log.Size||after.LastWriteTimeUtc.Ticks!=stamp)throw new IOException("읽는 동안 원본 파일이 변경되었습니다. 다시 첨부하세요.");
    foreach(var table in log.Tables.Values){if(table.Writer!=null){table.Writer.Dispose();table.Writer=null;}}
    log.Ready=true;string metadata=Metadata(log);File.WriteAllText(Path.Combine(log.Root,"manifest.json"),metadata,Encoding.UTF8);progress(1,"디스크 인덱스 완료");return metadata;
   }catch{
    foreach(var table in log.Tables.Values)if(table.Writer!=null){table.Writer.Dispose();table.Writer=null;}
    if(log.SourceHandle!=null){log.SourceHandle.Dispose();log.SourceHandle=null;}
    throw;
   }
  }}
  static int Size(char type){switch(type){case 'a':return 64;case 'b':case 'B':case 'M':return 1;case 'h':case 'H':case 'c':case 'C':return 2;case 'i':case 'I':case 'e':case 'E':case 'L':case 'f':return 4;case 'd':case 'q':case 'Q':return 8;case 'n':return 4;case 'N':return 16;case 'Z':return 64;default:return -1;}}
  static int Payload(string format){int size=0;foreach(char c in format){int n=Size(c);if(n<0)return -1;size+=n;}return size;}
  static string Ascii(byte[] bytes,int start,int count){var text=new StringBuilder();for(int i=0;i<count&&bytes[start+i]!=0;i++)if(bytes[start+i]>=32&&bytes[start+i]<=126)text.Append((char)bytes[start+i]);return text.ToString().Trim();}
  static bool NameValid(string name){return name.Length>0&&name.Length<=4&&name.All(c=>c>='A'&&c<='Z'||c>='a'&&c<='z'||c>='0'&&c<='9'||c=='_');}
  void AddSchema(DiskLog log,DiskSchema schema){
   schema.id=log.Schemas.Count;schema.timeOffset=FieldOffset(schema,"TimeUS");schema.timeType=FieldType(schema,"TimeUS");log.Schemas.Add(schema);
   if(!log.Tables.ContainsKey(schema.name)){string index=Path.Combine(log.Root,"table-"+log.Tables.Count+".idx");log.Tables.Add(schema.name,new DiskTable{Name=schema.name,Index=index,Writer=new BinaryWriter(new FileStream(index,FileMode.Create,FileAccess.Write,FileShare.Read,65536))});}
  }
  static void AddPacket(DiskLog log,DiskSchema schema,long position,int length,double time){var table=log.Tables[schema.name];table.Writer.Write(position);table.Writer.Write(schema.id);table.Writer.Write(length);table.Writer.Write(time);if(!Finite(time)||time<table.LastTime)table.Ordered=false;table.LastTime=time;table.Count++;schema.count++;log.Packets++;}
  void IndexBinary(DiskLog log,Action<double,string> progress){
   var active=new DiskSchema[256];var carry=new byte[0];long start=0;
   using(var input=new FileStream(log.Source,FileMode.Open,FileAccess.Read,FileShare.Read,1024*1024,FileOptions.SequentialScan)){
    var block=new byte[4*1024*1024];int n;
    while((n=input.Read(block,0,block.Length))>0){
     var scan=new byte[carry.Length+n];Buffer.BlockCopy(carry,0,scan,0,carry.Length);Buffer.BlockCopy(block,0,scan,carry.Length,n);long origin=start-carry.Length;int p=0;
     while(p+3<=scan.Length){
      if(scan[p]!=0xa3||scan[p+1]!=0x95){p++;continue;}int type=scan[p+2];
      if(type==128){
       if(p+89>scan.Length)break;
       string name=Ascii(scan,p+5,4),format=Ascii(scan,p+9,16);int payload=Payload(format);
       if(!NameValid(name)||payload<0||(scan[p+4]!=payload+3&&name!="FMT")){p+=2;continue;}
       var schema=new DiskSchema{typeId=scan[p+3],length=payload+3,name=name,format=format,columns=Ascii(scan,p+25,64).Split(',').Select(s=>s.Trim()).ToArray()};
       AddSchema(log,schema);active[schema.typeId]=schema;log.Packets++;p+=89;continue;
      }
      var current=active[type];if(current==null||current.length<3){p+=2;continue;}if(p+current.length>scan.Length)break;
      AddPacket(log,current,origin+p,current.length,current.timeOffset<0?Double.NaN:Numeric(scan,p+current.timeOffset,current.timeType));p+=current.length;
     }
     carry=new byte[scan.Length-p];Buffer.BlockCopy(scan,p,carry,0,carry.Length);start+=n;progress(start/Math.Max(1,log.Size),"전체 패킷 디스크 인덱스");
    }
   }
  }
  void IndexText(DiskLog log,Action<double,string> progress){
   var active=new Dictionary<string,DiskSchema>();long position=0,lineStart=0;var line=new MemoryStream();
   using(var input=new FileStream(log.Source,FileMode.Open,FileAccess.Read,FileShare.Read,1024*1024,FileOptions.SequentialScan)){
    var block=new byte[1024*1024];int n;
    while((n=input.Read(block,0,block.Length))>0){for(int i=0;i<n;i++,position++){
     if(block[i]==10){IndexTextLine(log,active,line.ToArray(),lineStart);line.SetLength(0);lineStart=position+1;}else line.WriteByte(block[i]);
    }progress(position/Math.Max(1,log.Size),"전체 텍스트 디스크 인덱스");}
   }
   if(line.Length>0)IndexTextLine(log,active,line.ToArray(),lineStart);line.Dispose();
  }
  void IndexTextLine(DiskLog log,Dictionary<string,DiskSchema> active,byte[] bytes,long position){
   var parts=Encoding.UTF8.GetString(bytes).Trim().Split(',').Select(s=>s.Trim()).ToArray();if(parts.Length==0||parts[0].Length==0)return;
   if(parts[0]=="FMT"&&parts.Length>=6){int type,length;int.TryParse(parts[1],out type);int.TryParse(parts[2],out length);
    var schema=new DiskSchema{typeId=type,length=length,name=parts[3],format=parts[4],columns=parts.Skip(5).ToArray()};AddSchema(log,schema);active[schema.name]=schema;log.Packets++;return;}
   DiskSchema current;if(active.TryGetValue(parts[0],out current)){int at=Array.IndexOf(current.columns,"TimeUS")+1;double time;if(at<1||at>=parts.Length||!Double.TryParse(parts[at],NumberStyles.Float,CultureInfo.InvariantCulture,out time))time=Double.NaN;AddPacket(log,current,position,bytes.Length,time);}
  }
  string Metadata(DiskLog log){
   var fmt=new {typeId=128,length=89,name="FMT",format="BBnNZ",columns=new[]{"Type","Length","Name","Format","Columns"},count=log.Schemas.Count};
   var definitions=log.Schemas.GroupBy(s=>s.name+"\0"+s.format+"\0"+String.Join(",",s.columns)).Select(g=>g.First()).Select(s=>(object)new {s.typeId,s.length,s.name,s.format,s.columns,s.count}).ToList();
   if(!log.Text){definitions=definitions.Where(item=>{var schema=Json().Deserialize<Dictionary<string,object>>(Json().Serialize(item));return (string)schema["name"]!="FMT"||(string)schema["format"]!="BBnNZ";}).ToList();definitions.Insert(0,fmt);}
   return Json().Serialize(new {nativeId=log.Id,fileName=log.Name,byteLength=log.Size,totalPackets=log.Packets,fmtList=definitions,rawCounts=log.Tables.ToDictionary(p=>p.Key,p=>p.Value.Count),tables=log.Tables.ToDictionary(p=>p.Key,p=>p.Value.Count),storage="native-disk",isText=log.Text,cacheBytes=new DirectoryInfo(log.Root).GetFiles().Sum(f=>f.Length)});
  }
  byte[] Bytes(DiskLog log,long position,int count){
   if(position<0||count<0||position+count>log.Size)throw new IOException("잘못된 원본 구간입니다.");
   if(mappedId!=log.Id){CloseMap();mapped=MemoryMappedFile.CreateFromFile(log.SourceHandle,null,0,MemoryMappedFileAccess.Read,HandleInheritability.None,true);mappedId=log.Id;}
   if(view==null||position<viewStart||position+count>viewStart+viewLength){if(view!=null)view.Dispose();viewStart=position/WindowBytes*WindowBytes;viewLength=Math.Min(log.Size-viewStart,Math.Max(WindowBytes,position-viewStart+count));view=mapped.CreateViewAccessor(viewStart,viewLength,MemoryMappedFileAccess.Read);}
   var result=new byte[count];view.ReadArray(position-viewStart,result,0,count);return result;
  }
  static object Number(double value){return new Dictionary<string,object>{{"$float64",Convert.ToBase64String(BitConverter.GetBytes(value))}};}
  static object Field(byte[] b,int p,char type){switch(type){
   case 'b':return (sbyte)b[p];case 'B':case 'M':return b[p];case 'h':return BitConverter.ToInt16(b,p);case 'H':return BitConverter.ToUInt16(b,p);
   case 'c':return Number(BitConverter.ToInt16(b,p)/100.0);case 'C':return Number(BitConverter.ToUInt16(b,p)/100.0);
   case 'i':return BitConverter.ToInt32(b,p);case 'I':return BitConverter.ToUInt32(b,p);
   case 'e':return Number(BitConverter.ToInt32(b,p)/100.0);case 'E':return Number(BitConverter.ToUInt32(b,p)/100.0);case 'L':return Number(BitConverter.ToInt32(b,p)*1e-7);
   case 'f':return Number(BitConverter.ToSingle(b,p));case 'd':return Number(BitConverter.ToDouble(b,p));
   case 'q':{long value=BitConverter.ToInt64(b,p);return value>9007199254740991L||value< -9007199254740991L?(object)value.ToString(CultureInfo.InvariantCulture):value;}
   case 'Q':{ulong value=BitConverter.ToUInt64(b,p);return value>9007199254740991UL?(object)value.ToString(CultureInfo.InvariantCulture):value;}
   case 'a':return Enumerable.Range(0,32).Select(i=>BitConverter.ToInt16(b,p+i*2)).ToArray();
   case 'n':case 'N':case 'Z':return Ascii(b,p,Size(type));default:return 0;
  }}
  static object TextNumber(string text,char type){
   if(type=='n'||type=='N'||type=='Z')return text;
   return new Dictionary<string,object>{{"$literal",text},{"$format",type.ToString()}};
  }
  public string ReadPage(string id,string tableName,int start,int count){lock(gate){
   var log=Log(id);DiskTable table;if(!log.Ready||!log.Tables.TryGetValue(tableName,out table))throw new IOException("없는 메시지입니다.");
   if(start<0||count<0||count>512)throw new IOException("페이지 크기가 잘못되었습니다.");
   int n=(int)Math.Max(0,Math.Min(count,table.Count-start));var rows=new List<object>(n);
   using(var index=new BinaryReader(new FileStream(table.Index,FileMode.Open,FileAccess.Read,FileShare.Read,8192))){index.BaseStream.Position=(long)start*24;
    for(int i=0;i<n;i++){
     long position=index.ReadInt64();int schemaID=index.ReadInt32(),length=index.ReadInt32();index.ReadDouble();var schema=log.Schemas[schemaID];byte[] bytes=Bytes(log,position,length);var row=new Dictionary<string,object>();
     if(log.Text){var parts=Encoding.UTF8.GetString(bytes).Trim().Split(',').Select(s=>s.Trim()).ToArray();for(int j=0;j<schema.columns.Length&&j+1<parts.Length;j++)row[schema.columns[j]]=TextNumber(parts[j+1],j<schema.format.Length?schema.format[j]:'f');}
     else{int offset=3;for(int j=0;j<schema.format.Length;j++){row[j<schema.columns.Length?schema.columns[j]:"F"+j]=Field(bytes,offset,schema.format[j]);offset+=Size(schema.format[j]);}}
     rows.Add(row);
    }
   }return Json().Serialize(rows);
  }}
  sealed class PlotPoint {public double X,Y;public long Index;}
  sealed class PlotBucket {public PlotPoint First,Last,Low,High,Gap;}
  sealed class PlotSeries {public object Instance;public long Count;public double Min=Double.PositiveInfinity,Max=Double.NegativeInfinity,Sum;public readonly Dictionary<int,PlotBucket> Buckets=new Dictionary<int,PlotBucket>();}
  static string Column(DiskSchema schema,int index){return index<schema.columns.Length?schema.columns[index]:"F"+index;}
  static int FieldOffset(DiskSchema schema,string column){int offset=3;for(int i=0;i<schema.format.Length;i++){if(Column(schema,i)==column)return offset;offset+=Size(schema.format[i]);}return -1;}
  static char FieldType(DiskSchema schema,string column){for(int i=0;i<Math.Max(schema.format.Length,schema.columns.Length);i++)if(Column(schema,i)==column)return i<schema.format.Length?schema.format[i]:'f';return '?';}
  static double Numeric(byte[] bytes,int offset,char type,int element=-1){if(offset<0)return Double.NaN;switch(type){
   case 'b':return (sbyte)bytes[offset];case 'B':case 'M':return bytes[offset];case 'h':return BitConverter.ToInt16(bytes,offset);case 'H':return BitConverter.ToUInt16(bytes,offset);
   case 'c':return BitConverter.ToInt16(bytes,offset)/100.0;case 'C':return BitConverter.ToUInt16(bytes,offset)/100.0;
   case 'i':return BitConverter.ToInt32(bytes,offset);case 'I':return BitConverter.ToUInt32(bytes,offset);case 'e':return BitConverter.ToInt32(bytes,offset)/100.0;case 'E':return BitConverter.ToUInt32(bytes,offset)/100.0;case 'L':return BitConverter.ToInt32(bytes,offset)*1e-7;
   case 'f':return BitConverter.ToSingle(bytes,offset);case 'd':return BitConverter.ToDouble(bytes,offset);
   case 'q':{long value=BitConverter.ToInt64(bytes,offset);return value>= -9007199254740991L&&value<=9007199254740991L?value:Double.NaN;}
   case 'Q':{ulong value=BitConverter.ToUInt64(bytes,offset);return value<=9007199254740991UL?value:Double.NaN;}
   case 'a':return element>=0&&element<32?BitConverter.ToInt16(bytes,offset+element*2):Double.NaN;default:return Double.NaN;
  }}
  static double QueryDouble(Dictionary<string,object> query,string key,double fallback){object value;if(!query.TryGetValue(key,out value)||value==null)return fallback;var bits=value as Dictionary<string,object>;return bits!=null?BitConverter.ToDouble(Convert.FromBase64String((string)bits["$float64"]),0):Convert.ToDouble(value,CultureInfo.InvariantCulture);}
  static long TimeBound(BinaryReader index,long count,double sec,bool upper){long left=0,right=count;while(left<right){long middle=left+(right-left)/2;index.BaseStream.Position=middle*24+16;double time=index.ReadDouble()/1e6;if(time<sec||upper&&time==sec)left=middle+1;else right=middle;}return left;}
  public string QueryField(string id,string json){int generation=System.Threading.Volatile.Read(ref plotGeneration);lock(gate){
   var log=Log(id);if(log.Text)throw new IOException("바이너리 전용 조회입니다.");var query=Json().Deserialize<Dictionary<string,object>>(json);
   string name=(string)query["message"],field=(string)query["field"],instanceKey=query.ContainsKey("instanceKey")?query["instanceKey"] as string:null,selected=query.ContainsKey("instance")?query["instance"] as string:null;
   DiskTable table;if(!log.Tables.TryGetValue(name,out table))return "[]";
   int element=-1,bracket=field.LastIndexOf('[');if(bracket>=0&&field.EndsWith("]")){int.TryParse(field.Substring(bracket+1,field.Length-bracket-2),out element);field=field.Substring(0,bracket);}
   double filterMin=QueryDouble(query,"filterMin",Double.NegativeInfinity),filterMax=QueryDouble(query,"filterMax",Double.PositiveInfinity),displayMin=QueryDouble(query,"min",0),displayMax=QueryDouble(query,"max",60);
   int buckets=600;var series=new Dictionary<string,PlotSeries>();
   var plans=log.Schemas.Where(schema=>schema.name==name).ToDictionary(schema=>schema.id,schema=>new[]{FieldOffset(schema,"TimeUS"),FieldOffset(schema,field),instanceKey==null?-1:FieldOffset(schema,instanceKey),(int)FieldType(schema,"TimeUS"),(int)FieldType(schema,field),instanceKey==null?'?':(int)FieldType(schema,instanceKey)});
   using(var index=new BinaryReader(new FileStream(table.Index,FileMode.Open,FileAccess.Read,FileShare.Read,1024*1024,FileOptions.SequentialScan))){
    long first=table.Ordered&&Finite(filterMin)?TimeBound(index,table.Count,filterMin,false):0,last=table.Ordered&&Finite(filterMax)?TimeBound(index,table.Count,filterMax,true):table.Count;index.BaseStream.Position=first*24;
    for(long i=first;i<last;i++){
     if((i&1023)==0&&generation!=System.Threading.Volatile.Read(ref plotGeneration))throw new OperationCanceledException("이전 차트 조회를 취소했습니다.");
     long position=index.ReadInt64();int schema=index.ReadInt32(),length=index.ReadInt32();double time=index.ReadDouble(),x=time/1e6;if(Double.IsNaN(x)||Double.IsInfinity(x)||x<filterMin||x>filterMax)continue;
     var plan=plans[schema];byte[] bytes=Bytes(log,position,length);
     double instance=Numeric(bytes,plan[2],(char)plan[5]);string group=instanceKey==null?"":Double.IsNaN(instance)?"undefined":instance.ToString("R",CultureInfo.InvariantCulture);
     if(selected!=null&&(instanceKey==null||selected!=group))continue;
     PlotSeries curve;if(!series.TryGetValue(group,out curve)){curve=new PlotSeries{Instance=instanceKey==null||Double.IsNaN(instance)?null:(object)instance};series.Add(group,curve);}
     double y=Numeric(bytes,plan[1],(char)plan[4],element);
     if(Double.IsNaN(y)||Double.IsInfinity(y)){if(x>=displayMin&&x<=displayMax){int gapBucket=(int)Math.Max(0,Math.Min(buckets-1,Math.Floor((x-displayMin)/Math.Max(1e-12,displayMax-displayMin)*buckets)));PlotBucket gap;if(!curve.Buckets.TryGetValue(gapBucket,out gap)){gap=new PlotBucket();curve.Buckets.Add(gapBucket,gap);}gap.Gap=new PlotPoint{X=x,Y=Double.NaN,Index=i};}continue;}
     if(y<curve.Min||y==0&&curve.Min==0&&BitConverter.DoubleToInt64Bits(y)<0)curve.Min=y;
     if(y>curve.Max||y==0&&curve.Max==0&&BitConverter.DoubleToInt64Bits(y)>=0)curve.Max=y;curve.Sum+=y;curve.Count++;
     if(x<displayMin||x>displayMax)continue;
     int bucket=(int)Math.Max(0,Math.Min(buckets-1,Math.Floor((x-displayMin)/Math.Max(1e-12,displayMax-displayMin)*buckets)));
     PlotBucket bin;if(!curve.Buckets.TryGetValue(bucket,out bin)){bin=new PlotBucket();curve.Buckets.Add(bucket,bin);}var point=new PlotPoint{X=x,Y=y,Index=i};
     if(bin.First==null)bin.First=point;bin.Last=point;if(bin.Low==null||y<bin.Low.Y)bin.Low=point;if(bin.High==null||y>bin.High.Y)bin.High=point;
    }
   }
   return Json().Serialize(series.Values.Select(curve=>new {instance=curve.Instance,data=curve.Buckets.OrderBy(pair=>pair.Key).SelectMany(pair=>new[]{pair.Value.First,pair.Value.Low,pair.Value.High,pair.Value.Last,pair.Value.Gap}.Where(point=>point!=null).GroupBy(point=>point.Index).Select(group=>group.First())).OrderBy(point=>point.X).ThenBy(point=>point.Index).Select(point=>new {x=Number(point.X),y=Double.IsNaN(point.Y)?null:Number(point.Y)}).ToArray(),statistics=curve.Count==0?null:new {min=Number(curve.Min),max=Number(curve.Max),mean=Number(curve.Sum/curve.Count)},count=curve.Count}).ToArray());
  }}
  sealed class CatalogSample {public DiskSchema Schema;public byte[] Bytes;public string[] Text;}
  sealed class CatalogBucket {public object Instance;public bool Undefined;public long Count;public readonly List<CatalogSample> Samples=new List<CatalogSample>();}
  IEnumerable<CatalogSample> Samples(DiskLog log,DiskTable table,long limit){
   using(var index=new BinaryReader(new FileStream(table.Index,FileMode.Open,FileAccess.Read,FileShare.Read,65536))){for(long i=0;i<Math.Min(table.Count,limit);i++){
    long position=index.ReadInt64();int schema=index.ReadInt32(),length=index.ReadInt32();index.ReadDouble();var bytes=Bytes(log,position,length);yield return new CatalogSample{Schema=log.Schemas[schema],Bytes=bytes,Text=log.Text?Encoding.UTF8.GetString(bytes).Trim().Split(',').Select(s=>s.Trim()).ToArray():null};
   }}
  }
  static object Unwrap(object value){var wrapper=value as Dictionary<string,object>;if(wrapper==null)return value;object item;if(wrapper.TryGetValue("$float64",out item))return BitConverter.ToDouble(Convert.FromBase64String((string)item),0);if(wrapper.TryGetValue("$literal",out item)){if((string)item=="")return 0;double number;if(Double.TryParse((string)item,NumberStyles.Float,CultureInfo.InvariantCulture,out number)&&Finite(number)){string format=Convert.ToString(wrapper["$format"]);if((format=="q"||format=="Q")&&(Math.Abs(number)>9007199254740991||Math.Truncate(number)!=number))return item;return number;}return item;}return value;}
  static bool Finite(double value){return !Double.IsNaN(value)&&!Double.IsInfinity(value);}
  static string InstanceText(object value){return value==null?"null":value is double?((double)value).ToString("R",CultureInfo.InvariantCulture):Convert.ToString(value,CultureInfo.InvariantCulture);}
  object SampleField(CatalogSample sample,string column){
   if(sample.Text!=null){int i=Array.IndexOf(sample.Schema.columns,column);return i<0||i+1>=sample.Text.Length?null:Unwrap(TextNumber(sample.Text[i+1],FieldType(sample.Schema,column)));}
   int offset=FieldOffset(sample.Schema,column);return offset<0?null:Unwrap(Field(sample.Bytes,offset,FieldType(sample.Schema,column)));
  }
  bool SampleNumeric(CatalogSample sample,string column,int element){
   if(sample.Text!=null){object value=SampleField(sample,column);return value is double&&Finite((double)value)||value is int||value is long||value is uint||value is byte;}
   return Finite(Numeric(sample.Bytes,FieldOffset(sample.Schema,column),FieldType(sample.Schema,column),element));
  }
  public string GetFieldCatalog(string id){lock(gate){
   var log=Log(id);if(log.Catalog!=null)return log.Catalog;
   var units=new Dictionary<int,string>();var fmtUnits=new Dictionary<int,string>();DiskTable metadata;
   if(log.Tables.TryGetValue("UNIT",out metadata))foreach(var sample in Samples(log,metadata,metadata.Count)){object value=SampleField(sample,"Id");if(value!=null){int number=Convert.ToInt32(value,CultureInfo.InvariantCulture);if(!units.ContainsKey(number))units[number]=Convert.ToString(SampleField(sample,"Label"),CultureInfo.InvariantCulture);}}
   if(log.Tables.TryGetValue("FMTU",out metadata))foreach(var sample in Samples(log,metadata,metadata.Count)){object value=SampleField(sample,"FmtType");if(value!=null){int type=Convert.ToInt32(value,CultureInfo.InvariantCulture);if(!fmtUnits.ContainsKey(type))fmtUnits[type]=Convert.ToString(SampleField(sample,"UnitIds"),CultureInfo.InvariantCulture);}}
   var result=new List<object>();
   foreach(var table in log.Tables.Values.Where(table=>table.Count>0).OrderBy(table=>table.Name,StringComparer.Ordinal)){
    var schemas=log.Schemas.Where(schema=>schema.name==table.Name).ToArray();string instanceField=null;bool hasMetadata=false;
    foreach(var schema in schemas){string ids;if(!fmtUnits.TryGetValue(schema.typeId,out ids))continue;hasMetadata=true;int i=ids.IndexOf('#');if(i>=0&&i<schema.columns.Length)instanceField=schema.columns[i];break;}
    if(!hasMetadata)instanceField=new[]{"I","Instance","IMU"}.FirstOrDefault(column=>schemas.Any(schema=>schema.columns.Contains(column)));
    var buckets=new Dictionary<string,CatalogBucket>();
    foreach(var sample in Samples(log,table,instanceField==null?64:table.Count)){
     object instance=instanceField==null?null:SampleField(sample,instanceField);bool missing=instanceField!=null&&instance==null;string key=missing?"undefined":InstanceText(instance);CatalogBucket bucket;
     if(!buckets.TryGetValue(key,out bucket)){bucket=new CatalogBucket{Instance=instance,Undefined=missing};buckets.Add(key,bucket);}bucket.Count++;if(bucket.Samples.Count<64)bucket.Samples.Add(sample);
    }
    var columns=schemas.SelectMany(schema=>schema.columns.Concat(Enumerable.Range(schema.columns.Length,Math.Max(0,schema.format.Length-schema.columns.Length)).Select(i=>"F"+i))).Distinct().ToArray();
    foreach(var bucket in buckets.Values.OrderBy(bucket=>{double n;return bucket.Instance!=null&&Double.TryParse(InstanceText(bucket.Instance),NumberStyles.Float,CultureInfo.InvariantCulture,out n)?n:0;})){
     if(instanceField==null)bucket.Count=table.Count;var fields=new List<object>();
     foreach(string column in columns){
      bool array=!log.Text&&bucket.Samples.Any(sample=>FieldType(sample.Schema,column)=='a');string unit=column=="TimeUS"?"µs":"";
      var schema=schemas.FirstOrDefault(s=>s.columns.Contains(column));string ids,label;if(column!="TimeUS"&&schema!=null&&fmtUnits.TryGetValue(schema.typeId,out ids)){int at=Array.IndexOf(schema.columns,column);if(at<ids.Length&&ids[at]!='#'&&ids[at]!='-'&&ids[at]!='?'&&units.TryGetValue(ids[at],out label))unit=label;}
      for(int element=0;element<(array?32:1);element++){int selected=array?element:-1;fields.Add(new {name=array?column+"["+element+"]":column,unit,numeric=bucket.Samples.Any(sample=>SampleNumeric(sample,column,selected))});}
     }
     var entry=new Dictionary<string,object>{{"name",instanceField!=null?table.Name+"["+(bucket.Undefined?"undefined":InstanceText(bucket.Instance))+"]":table.Name},{"baseName",table.Name},{"instanceField",instanceField},{"rows",bucket.Count},{"fields",fields}};
     if(!bucket.Undefined)entry["instance"]=bucket.Instance;result.Add(entry);
    }
   }
   log.Catalog=Json().Serialize(result);return log.Catalog;
  }}
  static string Collection(string name){if(!new[]{"timeline","unifiedEvents","parmRows","chartErrorMarkers","modeSegments","sorties","diagnostics"}.Contains(name))throw new IOException("허용되지 않은 컬렉션입니다.");return name;}
  public void BeginCollection(string id,string name){lock(gate){var log=Store(id);name=Collection(name);File.WriteAllBytes(Path.Combine(log.Root,name+".data"),new byte[0]);File.WriteAllBytes(Path.Combine(log.Root,name+".index"),new byte[0]);}}
  public void AppendCollection(string id,string name,string json){lock(gate){var log=Store(id);name=Collection(name);if(json.Length>4*1024*1024)throw new IOException("분석 페이지가 너무 큽니다.");byte[] bytes=Encoding.UTF8.GetBytes(json);
   using(var data=new FileStream(Path.Combine(log.Root,name+".data"),FileMode.Append,FileAccess.Write,FileShare.Read))
   using(var index=new BinaryWriter(new FileStream(Path.Combine(log.Root,name+".index"),FileMode.Append,FileAccess.Write,FileShare.Read))){index.Write(data.Position);using(var writer=new BinaryWriter(data)){writer.Write(bytes.Length);writer.Write(bytes);}}
  }}
  public void WriteCollectionPage(string id,string name,int page,string json){lock(gate){
   var log=Store(id);name=Collection(name);if(page<0||json.Length>4*1024*1024)throw new IOException("분석 페이지가 잘못되었습니다.");byte[] bytes=Encoding.UTF8.GetBytes(json);
   using(var data=new FileStream(Path.Combine(log.Root,name+".data"),FileMode.Append,FileAccess.Write,FileShare.Read))
   using(var index=new BinaryWriter(new FileStream(Path.Combine(log.Root,name+".index"),FileMode.Open,FileAccess.Write,FileShare.Read))){
    if((long)page*8>index.BaseStream.Length)throw new IOException("분석 페이지 순서가 잘못되었습니다.");index.BaseStream.Position=(long)page*8;index.Write(data.Position);
    using(var writer=new BinaryWriter(data)){writer.Write(bytes.Length);writer.Write(bytes);}
   }
  }}
  public string ReadCollection(string id,string name,int page){lock(gate){var log=Store(id);name=Collection(name);if(page<0)throw new IOException("잘못된 페이지입니다.");
   using(var index=new BinaryReader(File.OpenRead(Path.Combine(log.Root,name+".index")))){if((long)page*8>=index.BaseStream.Length)throw new IOException("없는 페이지입니다.");index.BaseStream.Position=(long)page*8;long offset=index.ReadInt64();
    using(var data=new BinaryReader(File.OpenRead(Path.Combine(log.Root,name+".data")))){data.BaseStream.Position=offset;int length=data.ReadInt32();if(length<0||length>16*1024*1024)throw new IOException("잘못된 분석 페이지입니다.");return Encoding.UTF8.GetString(data.ReadBytes(length));}
   }
  }}
  public void StoreAnalysis(string id,string json){lock(gate){if(json.Length>16*1024*1024)throw new IOException("분석 메타데이터가 너무 큽니다.");File.WriteAllText(Path.Combine(Store(id).Root,"analysis.json"),json,Encoding.UTF8);}}
  public string GetAnalysis(string id){lock(gate){var log=Store(id);return File.ReadAllText(Path.Combine(log.AnalysisId!=null?Store(log.AnalysisId).Root:log.Root,"analysis.json"),Encoding.UTF8);}}
  public void Release(string id){lock(gate){DiskLog log;if(!logs.TryGetValue(id,out log))return;if(mappedId==id)CloseMap();foreach(string key in analysisStores.Where(pair=>pair.Value.Source==id).Select(pair=>pair.Key).ToArray())analysisStores.Remove(key);logs.Remove(id);if(log.SourceHandle!=null)log.SourceHandle.Dispose();Directory.Delete(log.Root,true);}}
  public string BeginCsvExport(string suggestedName){
   using(var dialog=new SaveFileDialog{Filter="CSV 파일 (*.csv)|*.csv",DefaultExt="csv",AddExtension=true,FileName=Path.GetFileName(suggestedName),OverwritePrompt=true}){
    if((owner==null?dialog.ShowDialog():dialog.ShowDialog(owner))!=DialogResult.OK)return null;
    lock(gate){string token=Guid.NewGuid().ToString("N"),temporary=dialog.FileName+".logviewer-"+token+".partial";exports.Add(token,new CsvExport{Target=dialog.FileName,Temporary=temporary,Writer=new StreamWriter(temporary,false,new UTF8Encoding(true))});return token;}
   }
  }
  public void AppendCsvExport(string token,string text){lock(gate){CsvExport output;if(!exports.TryGetValue(token,out output)||text.Length>2*1024*1024)throw new IOException("CSV 저장 요청이 잘못되었습니다.");output.Writer.Write(text);}}
  public void FinishCsvExport(string token,bool success){lock(gate){CsvExport output;if(!exports.TryGetValue(token,out output))return;exports.Remove(token);output.Writer.Dispose();try{if(success){if(File.Exists(output.Target))File.Replace(output.Temporary,output.Target,null);else File.Move(output.Temporary,output.Target);}}finally{if(File.Exists(output.Temporary))File.Delete(output.Temporary);}}}
  internal object Dispatch(string method,object[] args){
   Func<int,string> s=i=>Convert.ToString(args[i],CultureInfo.InvariantCulture);Func<int,int> n=i=>Convert.ToInt32(args[i],CultureInfo.InvariantCulture);
   switch(method){case "QueryField":return QueryField(s(0),s(1));case "GetFieldCatalog":return GetFieldCatalog(s(0));case "BeginAnalysis":return BeginAnalysis(s(0));case "CommitAnalysis":CommitAnalysis(s(0),s(1));return null;case "AbortAnalysis":AbortAnalysis(s(0));return null;case "ReadPage":return ReadPage(s(0),s(1),n(2),n(3));case "BeginCollection":BeginCollection(s(0),s(1));return null;case "AppendCollection":AppendCollection(s(0),s(1),s(2));return null;case "WriteCollectionPage":WriteCollectionPage(s(0),s(1),n(2),s(3));return null;case "ReadCollection":return ReadCollection(s(0),s(1),n(2));case "StoreAnalysis":StoreAnalysis(s(0),s(1));return null;case "GetAnalysis":return GetAnalysis(s(0));default:throw new IOException("허용되지 않은 요청입니다.");}
  }
  void CloseMap(){if(view!=null){view.Dispose();view=null;}if(mapped!=null){mapped.Dispose();mapped=null;}mappedId=null;}
  public void Dispose(){lock(gate){CloseMap();foreach(string token in exports.Keys.ToArray())FinishCsvExport(token,false);foreach(var log in logs.Values){foreach(var table in log.Tables.Values)if(table.Writer!=null)table.Writer.Dispose();if(log.SourceHandle!=null)log.SourceHandle.Dispose();}logs.Clear();analysisStores.Clear();if(Directory.Exists(root))Directory.Delete(root,true);}}
  internal static int Test(string source,string report,bool dump){
   var timer=System.Diagnostics.Stopwatch.StartNew();string folder=Path.Combine(Path.GetDirectoryName(Path.GetFullPath(report)),"native-test-"+Guid.NewGuid().ToString("N"));
   using(var engine=new DiskLogBridge(folder,"")){
    var registered=engine.Register(new[]{source});var registration=Json().Deserialize<Dictionary<string,object>>(Json().Serialize(registered[0]));string id=(string)registration["nativeId"];
    string metadata=engine.Import(id,(fraction,stage)=>{});var log=engine.Log(id);long rows=log.Tables.Values.Sum(table=>table.Count);
    if(dump){using(var writer=new StreamWriter(report+".rows",false,new UTF8Encoding(false))){foreach(var table in log.Tables.Values)for(int i=0;i<table.Count;i+=256)writer.WriteLine(Json().Serialize(new {table=table.Name,start=i,rows=Json().DeserializeObject(engine.ReadPage(id,table.Name,i,256))}));}}
    else foreach(var table in log.Tables.Values.Where(table=>table.Count>0)){engine.ReadPage(id,table.Name,0,1);engine.ReadPage(id,table.Name,(int)(table.Count-1),1);}
    var plots=new Dictionary<string,object>();
    foreach(string field in new[]{"TEST.Value","CTUN.Alt","RCOU.C1"}){var parts=field.Split('.');if(!log.Text&&log.Tables.ContainsKey(parts[0])&&log.Schemas.Any(schema=>schema.name==parts[0]&&schema.columns.Contains(parts[1])))plots.Add(field,Json().DeserializeObject(engine.QueryField(id,Json().Serialize(new {message=parts[0],field=parts[1],min=0,max=20000}))));}
    var ranges=new Dictionary<string,object>();foreach(string field in plots.Keys){var parts=field.Split('.');ranges.Add(field,Json().DeserializeObject(engine.QueryField(id,Json().Serialize(new {message=parts[0],field=parts[1],min=0,max=2,filterMin=0,filterMax=2}))));}
    string generation=engine.BeginAnalysis(id);engine.StoreAnalysis(generation,"{\"generation\":1}");engine.CommitAnalysis(id,generation);string abandoned=engine.BeginAnalysis(id);engine.StoreAnalysis(abandoned,"{\"generation\":2}");engine.AbortAnalysis(abandoned);if(engine.GetAnalysis(id)!="{\"generation\":1}")throw new IOException("실패한 재분석이 기존 결과를 변경했습니다.");
    File.WriteAllText(report,Json().Serialize(new {metadata=Json().DeserializeObject(metadata),catalog=Json().DeserializeObject(engine.GetFieldCatalog(id)),rows,plots,ranges,atomicAnalysis=true,elapsedSeconds=timer.Elapsed.TotalSeconds,managedBytes=GC.GetTotalMemory(false),workingSet=System.Diagnostics.Process.GetCurrentProcess().WorkingSet64}),Encoding.UTF8);
   }return 0;
  }
  internal static int TestSourceProtection(string report){
   string folder=Path.Combine(Path.GetDirectoryName(Path.GetFullPath(report)),"native-source-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);string source=Path.Combine(folder,"input.log"),cache=Path.Combine(folder,"cache");
   byte[] original=Encoding.UTF8.GetBytes("FMT, 1, 15, TEST, Qf, TimeUS, Value\nTEST, 1000000, 7\n");File.WriteAllBytes(source,original);bool blockedWrite=false,blockedMove=false;
   try{using(var engine=new DiskLogBridge(cache,"")){
    var registration=Json().Deserialize<Dictionary<string,object>>(Json().Serialize(engine.Register(new[]{source})[0]));string id=(string)registration["nativeId"];engine.Import(id,(fraction,stage)=>{});
    if(Directory.GetFiles(cache,"original.dat",SearchOption.AllDirectories).Length!=0)throw new IOException("원본 복사본이 생성되었습니다.");
    try{using(var writer=new FileStream(source,FileMode.Open,FileAccess.Write,FileShare.ReadWrite)){} }catch(IOException){blockedWrite=true;}
    try{File.Move(source,source+".moved");}catch(IOException){blockedMove=true;}
    if(!blockedWrite||!blockedMove)throw new IOException("사용 중 원본 보호 실패");engine.ReadPage(id,"TEST",0,1);engine.Release(id);
    using(var writer=new FileStream(source,FileMode.Open,FileAccess.Write,FileShare.ReadWrite)){}
    if(!File.ReadAllBytes(source).SequenceEqual(original))throw new IOException("원본 내용이 변경되었습니다.");
   }File.WriteAllText(report,Json().Serialize(new {noSourceCopy=true,blockedWrite,blockedMove,unlockedAfterRelease=true,sourceUnchanged=true,cacheRemoved=!Directory.Exists(cache)}),Encoding.UTF8);}
   finally{if(Directory.Exists(folder))Directory.Delete(folder,true);}return 0;
  }
  internal static int TestBatch(string source,int count,string report){
   if(count<1||count>200)throw new IOException("테스트 개수가 잘못되었습니다.");
   string folder=Path.Combine(Path.GetDirectoryName(Path.GetFullPath(report)),"native-batch-"+Guid.NewGuid().ToString("N"));var timer=System.Diagnostics.Stopwatch.StartNew();long packets=-1,cacheBytes=0,peakManaged=0;
   using(var engine=new DiskLogBridge(folder,"")){
    var files=engine.Register(Enumerable.Repeat(source,count));
    foreach(var file in files){var descriptor=Json().Deserialize<Dictionary<string,object>>(Json().Serialize(file));string id=(string)descriptor["nativeId"];engine.Import(id,(fraction,phase)=>{});var log=engine.Log(id);if(packets>=0&&packets!=log.Packets)throw new IOException("패킷 수가 다릅니다.");packets=log.Packets;cacheBytes+=new DirectoryInfo(log.Root).GetFiles().Sum(entry=>entry.Length);foreach(var table in log.Tables.Values.Where(table=>table.Count>0)){engine.ReadPage(id,table.Name,0,1);engine.ReadPage(id,table.Name,(int)(table.Count-1),1);}peakManaged=Math.Max(peakManaged,GC.GetTotalMemory(false));}
    File.WriteAllText(report,Json().Serialize(new {files=count,inputBytes=new FileInfo(source).Length*count,packetsPerFile=packets,totalPackets=packets*count,cacheBytes,peakManagedBytes=peakManaged,peakWorkingSet=System.Diagnostics.Process.GetCurrentProcess().PeakWorkingSet64,elapsedSeconds=timer.Elapsed.TotalSeconds,allIndexesRetained=true}),Encoding.UTF8);
   }return 0;
  }
 }
}
