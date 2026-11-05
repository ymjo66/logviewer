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
    if(args.Length>1 && args[0]=="--verify-release")return VerifyRelease(args[1]);
    Cache=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LogViewer","app",VersionText+"-"+Hash(Resource("ViewerHtml")).Substring(0,12));
    Directory.CreateDirectory(Cache);
    foreach(string name in new[]{"Microsoft.Web.WebView2.Core.dll","Microsoft.Web.WebView2.WinForms.dll","WebView2Loader.dll"})File.WriteAllBytes(Path.Combine(Cache,name),Resource(name));
    File.WriteAllBytes(Path.Combine(Cache,"index.html"),Resource("ViewerHtml"));
    AppDomain.CurrentDomain.AssemblyResolve+=(sender,eventArgs)=>{
     string name=new AssemblyName(eventArgs.Name).Name+".dll";
     return name=="Microsoft.Web.WebView2.Core.dll"||name=="Microsoft.Web.WebView2.WinForms.dll"?Assembly.LoadFrom(Path.Combine(Cache,name)):null;
    };
    SetDllDirectory(Cache);
    return StartWindow();
   }catch(Exception error){MessageBox.Show(error.Message,"Log Viewer",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
  }
  [MethodImpl(MethodImplOptions.NoInlining)] static int StartWindow(){Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new ViewerForm());return 0;}
  internal static byte[] Resource(string name){using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(name)){if(stream==null)throw new IOException("Missing embedded resource: "+name);using(var buffer=new MemoryStream()){stream.CopyTo(buffer);return buffer.ToArray();}}}
  internal static string Hash(byte[] bytes){using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
  static int SelfTest(string path){
   bool resource=Encoding.UTF8.GetString(Resource("ViewerHtml")).Contains("analyzeParsedLog");
   var current=new Version(VersionText);string next="v"+current.Major+"."+current.Minor+"."+(current.Build+1);
   bool versions=Updater.IsNewer(next,VersionText)&&!Updater.IsNewer("v"+VersionText,VersionText)&&!Updater.IsNewer(next+"-beta",VersionText);
   string hash=Hash(new byte[]{1,2,3});bool checksums=Updater.Checksum(hash+"  LogViewer.exe\n")==hash;
   var mock=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>("{\"assets\":[{\"name\":\"LogViewer.exe\",\"browser_download_url\":\"https://github.com/ymjo66/logviewer/releases/download/v1.0.2/LogViewer.exe\"}]}");
   bool assets=Updater.AssetUrl(mock,"LogViewer.exe").EndsWith("/LogViewer.exe");
   File.WriteAllText(path,new JavaScriptSerializer().Serialize(new {version=VersionText,embeddedHtml=resource,versionComparison=versions,checksumManifest=checksums,releaseAssets=assets}),Encoding.UTF8);
   return resource&&versions&&checksums&&assets?0:1;
  }
  static int VerifyRelease(string path){try{var result=Updater.VerifyLatest().GetAwaiter().GetResult();File.WriteAllText(path,new JavaScriptSerializer().Serialize(result),Encoding.UTF8);return 0;}catch(Exception error){File.WriteAllText(path,new JavaScriptSerializer().Serialize(new {error=error.Message}),Encoding.UTF8);return 1;}}
 }

 internal sealed class ViewerForm:Form {
  readonly WebView2 browser=new WebView2();
  string readyFile,readyHash,documentUrl;bool checking;
  [DllImport("user32.dll")]static extern bool ReleaseCapture();
  [DllImport("user32.dll")]static extern IntPtr SendMessage(IntPtr window,int message,IntPtr wParam,IntPtr lParam);
  public ViewerForm(){
   Text="Log Viewer "+Program.VersionText;Width=1450;Height=950;MinimumSize=new Size(1000,700);StartPosition=FormStartPosition.CenterScreen;BackColor=Color.FromArgb(30,34,41);
   var workArea=Screen.PrimaryScreen.WorkingArea;Size=new Size(Math.Min(Width,workArea.Width),Math.Min(Height,workArea.Height));
   FormBorderStyle=FormBorderStyle.None;Padding=new Padding(5);
   using(var stream=new MemoryStream(Program.Resource("ViewerIcon")))Icon=new Icon(stream);
   browser.Dock=DockStyle.Fill;Controls.Add(browser);
   Shown+=async(sender,e)=>{await InitializeBrowser();await CheckUpdates();};
   FormClosed+=(sender,e)=>ApplyReadyUpdate();
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
    browser.CoreWebView2.SetVirtualHostNameToFolderMapping("logviewer.local",Program.Cache,CoreWebView2HostResourceAccessKind.DenyCors);
    browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
    documentUrl="https://logviewer.local/index.html?v="+Program.Hash(Program.Resource("ViewerHtml")).Substring(0,12);
    browser.CoreWebView2.WebMessageReceived+=(sender,e)=>{
     if(e.Source!=documentUrl)return;
     string command;try{command=e.TryGetWebMessageAsString();}catch{return;}
     if(command=="close")Close();
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
  static void OpenExternal(string url){Uri uri;if(Uri.TryCreate(url,UriKind.Absolute,out uri)&&uri.Scheme=="https")Process.Start(new ProcessStartInfo(uri.AbsoluteUri){UseShellExecute=true});}
  async Task CheckUpdates(){
   if(checking)return;checking=true;
   try {
    var release=await Updater.Latest();
    string tag=(string)release["tag_name"];
    if(!Updater.IsNewer(tag,Program.VersionText))return;
    var result=await Updater.Download(release);readyFile=result.Item1;readyHash=result.Item2;
   }catch(Exception){/* Offline operation is uninterrupted. Retry on the next launch. */}
   finally{checking=false;}
  }
  void ApplyReadyUpdate(){
   if(readyFile==null)return;
   string target=Application.ExecutablePath;
   var args="--apply-update "+Process.GetCurrentProcess().Id+" \""+target+"\" "+readyHash+" --no-restart";
   try{Process.Start(new ProcessStartInfo(readyFile,args){UseShellExecute=false,CreateNoWindow=true});}catch(Exception){/* Leave the installed version intact if the helper cannot start. */}
  }
 }

 internal static class Updater {
  const string Endpoint="https://api.github.com/repos/ymjo66/logviewer/releases/latest";
  internal static bool IsNewer(string tag,string current){Version next,old;return !tag.Contains("-")&&Version.TryParse(tag.TrimStart('v','V'),out next)&&Version.TryParse(current,out old)&&next>old;}
  static HttpClient Client(){var client=new HttpClient();client.Timeout=TimeSpan.FromSeconds(90);client.DefaultRequestHeaders.UserAgent.ParseAdd("LogViewer/"+Program.VersionText);client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");return client;}
  internal static async Task<Dictionary<string,object>> Latest(){using(var client=Client()){return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(await client.GetStringAsync(Endpoint));}}
  internal static async Task<object> VerifyLatest(){var release=await Latest();using(var client=Client()){string expected=Checksum(await client.GetStringAsync(AssetUrl(release,"SHA256SUMS.txt")));string actual=Program.Hash(await client.GetByteArrayAsync(AssetUrl(release,"LogViewer.exe")));if(expected!=actual)throw new IOException("Release checksum mismatch");return new {version=Program.VersionText,tag=(string)release["tag_name"],asset="LogViewer.exe",checksumVerified=true,updateAvailable=IsNewer((string)release["tag_name"],Program.VersionText)};}}
  internal static string Checksum(string manifest){foreach(var line in manifest.Split('\n')){var parts=line.Trim().Split(new[]{' ','\t'},StringSplitOptions.RemoveEmptyEntries);if(parts.Length==2&&parts[1]=="LogViewer.exe"&&parts[0].Length==64&&parts[0].All(Uri.IsHexDigit))return parts[0].ToLowerInvariant();}throw new IOException("업데이트 체크섬을 찾을 수 없습니다.");}
  internal static string AssetUrl(Dictionary<string,object> release,string name){foreach(var entry in (System.Collections.IEnumerable)release["assets"]){var asset=(Dictionary<string,object>)entry;if((string)asset["name"]==name){string url=(string)asset["browser_download_url"];if(!url.StartsWith("https://github.com/ymjo66/logviewer/releases/download/",StringComparison.OrdinalIgnoreCase))throw new IOException("잘못된 업데이트 경로");return url;}}throw new IOException("릴리즈 파일이 없습니다: "+name);}
  internal static async Task<Tuple<string,string>> Download(Dictionary<string,object> release){
   string tag=(string)release["tag_name"];Version version;if(!Version.TryParse(tag.TrimStart('v','V'),out version))throw new IOException("버전 형식 오류");
   using(var client=Client()){
    string hash=Checksum(await client.GetStringAsync(AssetUrl(release,"SHA256SUMS.txt")));
    byte[] bytes=await client.GetByteArrayAsync(AssetUrl(release,"LogViewer.exe"));
    if(Program.Hash(bytes)!=hash)throw new IOException("업데이트 파일 검증 실패");
    string directory=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LogViewer","updates",version.ToString());Directory.CreateDirectory(directory);
    string path=Path.Combine(directory,"LogViewer.exe");File.WriteAllBytes(path,bytes);return Tuple.Create(path,hash);
   }
  }
  internal static int Apply(string[] args){
   if(args.Length<4)return 2;
   try {
    string source=Assembly.GetExecutingAssembly().Location,target=Path.GetFullPath(args[2]);
    if(!target.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)||Program.Hash(File.ReadAllBytes(source))!=args[3])return 3;
    int pid;if(int.TryParse(args[1],out pid)&&pid>0)try{if(!Process.GetProcessById(pid).WaitForExit(120000))return 4;}catch(ArgumentException){}
    bool copied=false;
    for(int attempt=0;attempt<30;attempt++){try{if(File.Exists(target))File.Copy(target,target+".bak",true);File.Copy(source,target,true);copied=true;break;}catch(IOException){Thread.Sleep(500);}}
    if(!copied||Program.Hash(File.ReadAllBytes(target))!=args[3])throw new IOException("업데이트 적용 실패. 폴더의 쓰기 권한을 확인하세요.");
    if(!args.Contains("--no-restart"))Process.Start(new ProcessStartInfo(target){UseShellExecute=true});return 0;
   }catch(Exception error){MessageBox.Show(error.Message,"Log Viewer 업데이트",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
  }
 }
}
