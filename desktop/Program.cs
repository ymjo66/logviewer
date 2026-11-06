using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LogViewer {
 internal static class Program {
  internal static string Cache;
  internal static string VersionText { get { return Assembly.GetExecutingAssembly().GetName().Version.ToString(3); } }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetDllDirectory(string path);
  [STAThread] static int Main(string[] args) {
   try {
    ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
    if(args.Length>0 && args[0]=="--apply-update")return Updater.Apply(args);
    if(args.Length>1 && args[0]=="--self-test")return SelfTest(args[1]);
    if(args.Length>1 && args[0]=="--disk-source-test")return DiskLogBridge.TestSourceProtection(args[1]);
    if(args.Length>1 && args[0]=="--verify-release")return VerifyRelease(args[1]);
    if(args.Length>1 && args[0]=="--stage-update")return StageUpdate(args[1]);
    if(args.Length>1 && args[0]=="--verify-fallback")return StageUpdate(args[1],true);
    if(args.Length>2 && (args[0]=="--disk-test"||args[0]=="--disk-dump"))return DiskLogBridge.Test(args[1],args[2],args[0]=="--disk-dump");
    if(args.Length>3 && args[0]=="--disk-batch")return DiskLogBridge.TestBatch(args[1],Int32.Parse(args[2]),args[3]);
    Cache=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LogViewer","app",VersionText+"-"+Hash(Resource("ViewerHtml")).Substring(0,12));
    Directory.CreateDirectory(Cache);
    foreach(string name in new[]{"Microsoft.Web.WebView2.Core.dll","Microsoft.Web.WebView2.WinForms.dll","WebView2Loader.dll"})EnsureResourceFile(name,name);
    EnsureResourceFile("index.html","ViewerHtml");
    AppDomain.CurrentDomain.AssemblyResolve+=(sender,eventArgs)=>{
     string name=new AssemblyName(eventArgs.Name).Name+".dll";
     return name=="Microsoft.Web.WebView2.Core.dll"||name=="Microsoft.Web.WebView2.WinForms.dll"?Assembly.LoadFrom(Path.Combine(Cache,name)):null;
    };
    SetDllDirectory(Cache);
    return StartWindow();
   }catch(Exception error){MessageBox.Show(error.Message,"Log Viewer",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
  }
  [MethodImpl(MethodImplOptions.NoInlining)] static int StartWindow(){Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new ViewerForm());return 0;}
  static void EnsureResourceFile(string name,string resource){var bytes=Resource(resource);string path=Path.Combine(Cache,name);if(File.Exists(path)&&Hash(File.ReadAllBytes(path))==Hash(bytes))return;File.WriteAllBytes(path,bytes);}
  internal static byte[] Resource(string name){using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(name)){if(stream==null)throw new IOException("Missing embedded resource: "+name);using(var buffer=new MemoryStream()){stream.CopyTo(buffer);return buffer.ToArray();}}}
  internal static string Hash(byte[] bytes){using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
  static int SelfTest(string path){
   bool resource=Encoding.UTF8.GetString(Resource("ViewerHtml")).Contains("analyzeParsedLog");
   var current=new Version(VersionText);string next="v"+current.Major+"."+current.Minor+"."+(current.Build+1);
   bool versions=Updater.IsNewer(next,VersionText)&&!Updater.IsNewer("v"+VersionText,VersionText)&&!Updater.IsNewer(next+"-beta",VersionText);
   string hash=Hash(new byte[]{1,2,3});bool checksums=Updater.Checksum(hash+"  LogViewer.exe\n")==hash;
   var mock=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>("{\"assets\":[{\"name\":\"LogViewer.exe\",\"browser_download_url\":\"https://github.com/ymjo66/logviewer/releases/download/v1.0.2/LogViewer.exe\"}]}");
   bool assets=Updater.AssetUrl(mock,"LogViewer.exe").EndsWith("/LogViewer.exe");
   bool plans=Updater.ShouldInstall("v"+VersionText,VersionText,"new","old")&&!Updater.ShouldInstall("v"+VersionText,VersionText,"same","same")&&!Updater.ShouldInstall("v0.9.0",VersionText,"new","old")&&Updater.ShouldInstall(next,VersionText,"same","same");
   bool buildOrder=!Updater.HasNewerBuild(mock);
   var mockAsset=(Dictionary<string,object>)((System.Collections.IEnumerable)mock["assets"]).Cast<object>().First();
   mockAsset["updated_at"]="2000-01-01T00:00:00Z";buildOrder=buildOrder&&!Updater.HasNewerBuild(mock);
   mockAsset["updated_at"]="2099-01-01T00:00:00Z";buildOrder=buildOrder&&Updater.HasNewerBuild(mock);
   File.WriteAllText(path,new JavaScriptSerializer().Serialize(new {version=VersionText,embeddedHtml=resource,versionComparison=versions,checksumManifest=checksums,releaseAssets=assets,sameVersionReplacement=plans,olderBuildRejected=buildOrder}),Encoding.UTF8);
   return resource&&versions&&checksums&&assets&&plans&&buildOrder?0:1;
  }
  static int VerifyRelease(string path){try{var result=Updater.VerifyLatest().GetAwaiter().GetResult();File.WriteAllText(path,new JavaScriptSerializer().Serialize(result),Encoding.UTF8);return 0;}catch(Exception error){File.WriteAllText(path,new JavaScriptSerializer().Serialize(new {error=error.Message}),Encoding.UTF8);return 1;}}
  static int StageUpdate(string path,bool fallback=false){try{var release=(fallback?Updater.LatestFromWebsite():Updater.Latest()).GetAwaiter().GetResult();var staged=Updater.Download(release).GetAwaiter().GetResult();File.WriteAllText(path,new JavaScriptSerializer().Serialize(new {tag=(string)release["tag_name"],source=fallback?"website-fallback":"api",downloaded=true,checksumVerified=Hash(File.ReadAllBytes(staged.Item1))==staged.Item2,bytes=new FileInfo(staged.Item1).Length}),Encoding.UTF8);return 0;}catch(Exception error){File.WriteAllText(path,new JavaScriptSerializer().Serialize(new {error=error.Message}),Encoding.UTF8);return 1;}}
 }

 internal sealed class ViewerForm:Form {
  readonly WebView2 browser=new WebView2();
  DiskLogBridge diskBridge;string diskEndpoint;
  string readyFile,readyHash,documentUrl,updateStage="idle",updateMessage="자동 업데이트 대기";bool checking;
  readonly System.Windows.Forms.Timer updateTimer=new System.Windows.Forms.Timer();
  [DllImport("user32.dll")]static extern bool ReleaseCapture();
  [DllImport("user32.dll")]static extern IntPtr SendMessage(IntPtr window,int message,IntPtr wParam,IntPtr lParam);
  public ViewerForm(){
   Text="Log Viewer "+Program.VersionText;Width=1450;Height=950;MinimumSize=new Size(1000,700);StartPosition=FormStartPosition.CenterScreen;BackColor=Color.FromArgb(30,34,41);
   var workArea=Screen.PrimaryScreen.WorkingArea;Size=new Size(Math.Min(Width,workArea.Width),Math.Min(Height,workArea.Height));
   FormBorderStyle=FormBorderStyle.None;Padding=new Padding(5);
   using(var stream=new MemoryStream(Program.Resource("ViewerIcon")))Icon=new Icon(stream);
   browser.Dock=DockStyle.Fill;Controls.Add(browser);
   Shown+=async(sender,e)=>{await InitializeBrowser();await CheckUpdates();};
   updateTimer.Interval=10*60*1000;updateTimer.Tick+=async(sender,e)=>{if(readyFile==null)await CheckUpdates();};updateTimer.Start();
   FormClosed+=(sender,e)=>{updateTimer.Stop();updateTimer.Dispose();browser.Dispose();try{if(diskBridge!=null)diskBridge.Dispose();}catch(Exception error){Updater.Log("disk-cleanup",error.Message);}ApplyReadyUpdate();};
  }
  protected override void WndProc(ref Message message){
   base.WndProc(ref message);
   if(message.Msg!=0x84||WindowState!=FormWindowState.Normal)return;
   long packed=message.LParam.ToInt64();var p=PointToClient(new Point((short)(packed&0xffff),(short)((packed>>16)&0xffff)));
   const int edge=5;bool left=p.X<edge,right=p.X>=ClientSize.Width-edge,top=p.Y<edge,bottom=p.Y>=ClientSize.Height-edge;
   if(top)message.Result=(IntPtr)(left?13:right?14:12);else if(bottom)message.Result=(IntPtr)(left?16:right?17:15);else if(left)message.Result=(IntPtr)10;else if(right)message.Result=(IntPtr)11;
  }
  async Task InitializeBrowser(){
   try {
    var profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LogViewer","browser");
    var environment=await CoreWebView2Environment.CreateAsync(null,profile);
    await browser.EnsureCoreWebView2Async(environment);
    // Keep the engine endpoint separate from the static virtual-host mapping.
    diskEndpoint="https://engine.logviewer.local/"+Guid.NewGuid().ToString("N");
    diskBridge=new DiskLogBridge(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LogViewer","disk-cache",Guid.NewGuid().ToString("N")),diskEndpoint,this);
    browser.CoreWebView2.AddHostObjectToScript("diskLogs",diskBridge);
    browser.CoreWebView2.AddWebResourceRequestedFilter(diskEndpoint,CoreWebView2WebResourceContext.All,CoreWebView2WebResourceRequestSourceKinds.All);
    browser.CoreWebView2.WebResourceRequested+=async(sender,e)=>{
     if(e.Request.Uri!=diskEndpoint)return;var deferral=e.GetDeferral();
     try{
      const string cors="Access-Control-Allow-Origin: https://logviewer.local\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nCache-Control: no-store\r\n";
      if(e.Request.Method=="OPTIONS"){e.Response=environment.CreateWebResourceResponse(new MemoryStream(new byte[0]),200,"OK",cors);return;}
      if(e.Request.Method!="POST")throw new IOException("잘못된 엔진 요청입니다.");
      string origin=e.Request.Headers.Contains("Origin")?e.Request.Headers.GetHeader("Origin"):"";
      if(origin.Length>0&&origin!="https://logviewer.local")throw new IOException("허용되지 않은 요청 출처입니다.");
      string text;using(var reader=new StreamReader(e.Request.Content)){var buffer=new char[4096];var builder=new StringBuilder();int count;while((count=reader.Read(buffer,0,buffer.Length))>0){builder.Append(buffer,0,count);if(builder.Length>5*1024*1024)throw new IOException("요청이 너무 큽니다.");}text=builder.ToString();}
      var request=DiskLogBridge.Json().Deserialize<Dictionary<string,object>>(text);
      var args=((System.Collections.IEnumerable)request["args"]).Cast<object>().ToArray();
      object result=await Task.Run(()=>diskBridge.Dispatch((string)request["method"],args));
      byte[] bytes=Encoding.UTF8.GetBytes(DiskLogBridge.Json().Serialize(new {result}));
      e.Response=environment.CreateWebResourceResponse(new MemoryStream(bytes),200,"OK",cors+"Content-Type: application/json; charset=utf-8");
     }catch(Exception error){Updater.Log("disk-api-error",error.Message);if(!browser.IsDisposed)try{e.Response=environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(DiskLogBridge.Json().Serialize(new {error=error.Message}))),400,"Bad Request","Content-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: https://logviewer.local");}catch(COMException){}catch(InvalidOperationException){}}
     finally{try{deferral.Complete();}catch(COMException){}catch(InvalidOperationException){}}
    };
    browser.CoreWebView2.SetVirtualHostNameToFolderMapping("logviewer.local",Program.Cache,CoreWebView2HostResourceAccessKind.DenyCors);
    browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
    documentUrl="https://logviewer.local/index.html?v="+Program.Hash(Program.Resource("ViewerHtml")).Substring(0,12);
    browser.CoreWebView2.WebMessageReceived+=async(sender,e)=>{
     if(e.Source!=documentUrl)return;
     string command;try{command=e.TryGetWebMessageAsString();}catch{return;}
     if(command.StartsWith("{")){
      Dictionary<string,object> request;try{request=DiskLogBridge.Json().Deserialize<Dictionary<string,object>>(command);}catch{return;}
      string action=request.ContainsKey("action")?Convert.ToString(request["action"]):"";
      if(action=="disk.pick"||action=="disk.drop"){
       try{
        string[] paths;
        if(action=="disk.pick"){using(var picker=new OpenFileDialog{Filter="드론 로그 (*.bin;*.log)|*.bin;*.log",Multiselect=true}){if(picker.ShowDialog(this)!=DialogResult.OK)return;paths=picker.FileNames;}}
        else paths=e.AdditionalObjects.OfType<CoreWebView2File>().Select(file=>file.Path).ToArray();
        PostDiskMessage(new {type="disk-files",files=diskBridge.Register(paths)});
       }catch(Exception error){PostDiskMessage(new {type="disk-error",message=error.Message});}
       return;
      }
      if(action=="disk.index"){
       string requestId=Convert.ToString(request["requestId"]),id=Convert.ToString(request["id"]);long last=0;
       try{string metadata=await Task.Run(()=>diskBridge.Import(id,(fraction,phase)=>{long now=DateTime.UtcNow.Ticks;if(now-last<TimeSpan.TicksPerMillisecond*150&&fraction<1)return;last=now;PostDiskMessage(new {type="disk-progress",requestId,fraction,phase});}));PostDiskMessage(new {type="disk-result",requestId,metadata});}
       catch(Exception error){try{diskBridge.Release(id);}catch{}PostDiskMessage(new {type="disk-result",requestId,error=error.Message});}
       return;
      }
      return;
     }
     if(command=="ready")SendUpdateState();
     else if(command=="close")Close();
     else if(command=="minimize")WindowState=FormWindowState.Minimized;
     else if(command=="maximize"){MaximizedBounds=Screen.FromHandle(Handle).WorkingArea;WindowState=WindowState==FormWindowState.Maximized?FormWindowState.Normal:FormWindowState.Maximized;}
     else if(command=="drag"){ReleaseCapture();SendMessage(Handle,0xA1,(IntPtr)2,IntPtr.Zero);}
    };
    browser.CoreWebView2.NewWindowRequested+=(sender,e)=>{e.Handled=true;OpenExternal(e.Uri);};
    browser.CoreWebView2.NavigationStarting+=(sender,e)=>{if(!e.Uri.StartsWith("https://logviewer.local/",StringComparison.OrdinalIgnoreCase)){e.Cancel=true;OpenExternal(e.Uri);}};
    browser.Source=new Uri(documentUrl);
   }catch(Exception error){
    MessageBox.Show("Microsoft Edge WebView2 Runtime이 필요합니다.\n\n"+error.Message+"\n\nhttps://developer.microsoft.com/microsoft-edge/webview2/",Text,MessageBoxButtons.OK,MessageBoxIcon.Error);
   }
  }
  void PostDiskMessage(object message){if(IsDisposed||Disposing||browser.IsDisposed)return;if(InvokeRequired){try{BeginInvoke(new Action(()=>PostDiskMessage(message)));}catch(InvalidOperationException){}return;}try{browser.CoreWebView2.PostWebMessageAsJson(DiskLogBridge.Json().Serialize(message));}catch(InvalidOperationException){}catch(COMException){}}
  static void OpenExternal(string url){Uri uri;if(Uri.TryCreate(url,UriKind.Absolute,out uri)&&uri.Scheme=="https")Process.Start(new ProcessStartInfo(uri.AbsoluteUri){UseShellExecute=true});}
  void SendUpdateState(){try{if(browser.CoreWebView2!=null)browser.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(new {type="updateStatus",version=Program.VersionText,stage=updateStage,message=updateMessage}));}catch(Exception){}}
  void SetUpdateState(string stage,string message){updateStage=stage;updateMessage=message;Updater.Log(stage,message);SendUpdateState();}
  async Task CheckUpdates(){
   if(checking)return;checking=true;
   try {
    SetUpdateState("checking","자동 업데이트 확인 중");
    var release=await Updater.Latest();
    string tag=(string)release["tag_name"];
    Version offered;if(!Version.TryParse(tag.TrimStart('v','V'),out offered))throw new IOException("릴리즈 버전 형식 오류");
    if(offered<new Version(Program.VersionText)){SetUpdateState("current","현재 설치된 버전을 유지합니다");return;}
    if(!Updater.IsNewer(tag,Program.VersionText)){
     if(!Updater.HasNewerBuild(release)){SetUpdateState("current","현재 수정본을 유지합니다 · 더 오래된 동일 버전은 적용하지 않습니다");return;}
     string remoteHash=await Updater.ReleaseChecksum(release);
     if(!Updater.ShouldInstall(tag,Program.VersionText,remoteHash,Program.Hash(File.ReadAllBytes(Application.ExecutablePath)))){SetUpdateState("current","최신 배포 파일을 사용 중입니다");return;}
    }
    SetUpdateState("downloading",tag+" 다운로드 및 무결성 확인 중");
    var result=await Updater.Download(release);readyFile=result.Item1;readyHash=result.Item2;
    SetUpdateState("ready",tag+" 준비 완료 · 프로그램을 종료하면 적용됩니다");
   }catch(Exception error){SetUpdateState("failed","업데이트 확인을 완료하지 못했습니다. 10분 후 다시 확인합니다.");Updater.Log("error",error.GetType().Name+": "+error.Message);}
   finally{checking=false;}
  }
  void ApplyReadyUpdate(){
   if(readyFile==null)return;
   string target=Application.ExecutablePath;
   var args="--apply-update "+Process.GetCurrentProcess().Id+" \""+target+"\" "+readyHash+" --no-restart";
   try{Updater.Log("apply","종료 후 업데이트 파일 교체 시작");Process.Start(new ProcessStartInfo(readyFile,args){UseShellExecute=false,CreateNoWindow=true});}catch(Exception error){Updater.Log("apply-error",error.Message);}
  }
 }

 internal static class Updater {
  const string Endpoint="https://api.github.com/repos/ymjo66/logviewer/releases/latest";
  internal static void Log(string stage,string message){try{string dir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LogViewer");Directory.CreateDirectory(dir);string path=Path.Combine(dir,"update.log");if(File.Exists(path)&&new FileInfo(path).Length>262144)File.Copy(path,path+".previous",true);if(File.Exists(path)&&new FileInfo(path).Length>262144)File.WriteAllText(path,"");File.AppendAllText(path,DateTime.UtcNow.ToString("o")+" ["+stage+"] "+message.Replace("\r"," ").Replace("\n"," ")+Environment.NewLine,Encoding.UTF8);}catch(Exception){}}
  internal static bool IsNewer(string tag,string current){Version next,old;return !tag.Contains("-")&&Version.TryParse(tag.TrimStart('v','V'),out next)&&Version.TryParse(current,out old)&&next>old;}
  internal static bool ShouldInstall(string tag,string current,string remoteHash,string localHash){Version next,old;return !tag.Contains("-")&&Version.TryParse(tag.TrimStart('v','V'),out next)&&Version.TryParse(current,out old)&&(next>old||next==old&&!String.Equals(remoteHash,localHash,StringComparison.OrdinalIgnoreCase));}
  internal static bool HasNewerBuild(Dictionary<string,object> release){
   DateTime built=DateTime.Parse(BuildInfo.Utc,null,System.Globalization.DateTimeStyles.RoundtripKind).ToUniversalTime();
   foreach(var entry in (System.Collections.IEnumerable)release["assets"]){
    var asset=(Dictionary<string,object>)entry;object timestamp;DateTime uploaded;
    if((string)asset["name"]=="LogViewer.exe"&&asset.TryGetValue("updated_at",out timestamp)&&DateTime.TryParse(Convert.ToString(timestamp),null,System.Globalization.DateTimeStyles.RoundtripKind,out uploaded))return uploaded.ToUniversalTime()>built;
   }
   // The website fallback has no asset date; do not replace an equal version
   // when its build order cannot be established. Higher versions still update.
   return false;
  }
  static HttpClient Client(int seconds=60){var client=new HttpClient();client.Timeout=TimeSpan.FromSeconds(seconds);client.DefaultRequestHeaders.UserAgent.ParseAdd("LogViewer/"+Program.VersionText);client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");client.DefaultRequestHeaders.CacheControl=new System.Net.Http.Headers.CacheControlHeaderValue{NoCache=true};return client;}
  static async Task<T> Retry<T>(Func<Task<T>> action){
   Exception last=null;
   for(int i=0;i<3;i++){
    try{return await action();}
    catch(Exception error){if(!(error is HttpRequestException)&&!(error is TaskCanceledException)&&!(error is IOException))throw;last=error;Log("retry",error.GetType().Name+": "+error.Message);}
    if(i<2)await Task.Delay(1000*(i+1));
   }
   throw last;
  }
  internal static async Task<Dictionary<string,object>> Latest(){
   try{return await Retry(async()=>{using(var client=Client(15))return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(await client.GetStringAsync(Endpoint));});}
   catch(Exception error){Log("fallback",error.Message);}
   return await LatestFromWebsite();
  }
  internal static async Task<Dictionary<string,object>> LatestFromWebsite(){
   return await Retry(async()=>{
    using(var client=Client(20))using(var response=await client.GetAsync("https://github.com/ymjo66/logviewer/releases/latest",HttpCompletionOption.ResponseHeadersRead)){
     response.EnsureSuccessStatusCode();string address=response.RequestMessage.RequestUri.AbsoluteUri,prefix="https://github.com/ymjo66/logviewer/releases/tag/";
     if(!address.StartsWith(prefix,StringComparison.Ordinal))throw new IOException("최신 릴리즈 경로를 확인할 수 없습니다.");
     string tag=Uri.UnescapeDataString(address.Substring(prefix.Length));Version version;
     if(tag.Contains("-")||!Version.TryParse(tag.TrimStart('v','V'),out version))throw new IOException("최신 릴리즈 버전 형식 오류");
     var assets=new List<object>();
     foreach(string name in new[]{"LogViewer.exe","SHA256SUMS.txt"})assets.Add(new Dictionary<string,object>{{"name",name},{"browser_download_url","https://github.com/ymjo66/logviewer/releases/download/"+Uri.EscapeDataString(tag)+"/"+name}});
     return new Dictionary<string,object>{{"tag_name",tag},{"assets",assets}};
    }
   });
  }
  internal static async Task<string> ReleaseChecksum(Dictionary<string,object> release){return await Retry(async()=>{using(var client=Client(30))return Checksum(await client.GetStringAsync(AssetUrl(release,"SHA256SUMS.txt")));});}
  internal static async Task<object> VerifyLatest(){var release=await Latest();using(var client=Client()){string expected=await ReleaseChecksum(release);string actual=Program.Hash(await client.GetByteArrayAsync(AssetUrl(release,"LogViewer.exe")));if(expected!=actual)throw new IOException("Release checksum mismatch");return new {version=Program.VersionText,tag=(string)release["tag_name"],asset="LogViewer.exe",checksumVerified=true,updateAvailable=ShouldInstall((string)release["tag_name"],Program.VersionText,expected,Program.Hash(File.ReadAllBytes(Assembly.GetExecutingAssembly().Location)))};}}
  internal static string Checksum(string manifest){foreach(var line in manifest.Split('\n')){var parts=line.Trim().Split(new[]{' ','\t'},StringSplitOptions.RemoveEmptyEntries);if(parts.Length==2&&parts[1]=="LogViewer.exe"&&parts[0].Length==64&&parts[0].All(Uri.IsHexDigit))return parts[0].ToLowerInvariant();}throw new IOException("업데이트 체크섬을 찾을 수 없습니다.");}
  internal static string AssetUrl(Dictionary<string,object> release,string name){foreach(var entry in (System.Collections.IEnumerable)release["assets"]){var asset=(Dictionary<string,object>)entry;if((string)asset["name"]==name){string url=(string)asset["browser_download_url"];if(!url.StartsWith("https://github.com/ymjo66/logviewer/releases/download/",StringComparison.OrdinalIgnoreCase))throw new IOException("잘못된 업데이트 경로");return url;}}throw new IOException("릴리즈 파일이 없습니다: "+name);}
  internal static async Task<Tuple<string,string>> Download(Dictionary<string,object> release){
   string tag=(string)release["tag_name"];Version version;if(!Version.TryParse(tag.TrimStart('v','V'),out version))throw new IOException("버전 형식 오류");
   {
    string hash=await ReleaseChecksum(release);
    string directory=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LogViewer","updates",version.ToString()+"-"+hash.Substring(0,12));Directory.CreateDirectory(directory);
    string path=Path.Combine(directory,"LogViewer.exe");
    if(File.Exists(path)&&Program.Hash(File.ReadAllBytes(path))==hash){Log("download","검증된 다운로드 파일 재사용");return Tuple.Create(path,hash);}
    byte[] bytes=await Retry(async()=>{using(var client=Client(60))return await client.GetByteArrayAsync(AssetUrl(release,"LogViewer.exe"));});
    if(Program.Hash(bytes)!=hash)throw new IOException("업데이트 파일 검증 실패");
    string partial=path+".partial";File.WriteAllBytes(partial,bytes);File.Copy(partial,path,true);File.Delete(partial);Log("download","파일 다운로드 및 SHA256 검증 완료");return Tuple.Create(path,hash);
   }
  }
  internal static int Apply(string[] args){
   if(args.Length<4)return 2;
   try {
    string source=Assembly.GetExecutingAssembly().Location,target=Path.GetFullPath(args[2]);
    if(!target.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)||Program.Hash(File.ReadAllBytes(source))!=args[3])return 3;
    int pid;if(int.TryParse(args[1],out pid)&&pid>0)try{if(!Process.GetProcessById(pid).WaitForExit(120000))return 4;}catch(ArgumentException){}
    string staged=target+".update-"+Guid.NewGuid().ToString("N");File.Copy(source,staged);if(Program.Hash(File.ReadAllBytes(staged))!=args[3])throw new IOException("업데이트 임시 파일 검증 실패");
    bool copied=false;
    try{for(int attempt=0;attempt<30;attempt++){try{if(File.Exists(target))File.Replace(staged,target,target+".bak");else File.Move(staged,target);copied=true;break;}catch(IOException){Thread.Sleep(500);}}}finally{if(File.Exists(staged))File.Delete(staged);}
    if(!copied||Program.Hash(File.ReadAllBytes(target))!=args[3])throw new IOException("업데이트 적용 실패. 폴더의 쓰기 권한을 확인하세요.");
    Log("applied","업데이트 파일 교체 및 SHA256 검증 완료");if(!args.Contains("--no-restart"))Process.Start(new ProcessStartInfo(target){UseShellExecute=true});return 0;
   }catch(Exception error){Log("apply-error",error.GetType().Name+": "+error.Message);return 1;}
  }
 }
}
