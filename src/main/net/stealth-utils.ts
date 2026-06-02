/**
 * Stealth Utilities — مكتبة مشتركة لتجاوز الحماية
 *
 * توفر:
 * 1. تدوير User-Agent (200+ وكيل مستخدم حقيقي)
 * 2. تدوير fingerprint (viewport, languages, platform)
 * 3. Auto Retry مع exponential backoff
 * 4. stealth script محسّن لـ Cloudflare و Datadome
 */
import { createLogger } from '../logger';

const log = createLogger('stealth-utils');

// ─── User-Agent Pool ──────────────────────────────────────────────────────────

const UA_POOL = [
  // Chrome on Windows (most common)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Chrome on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Edge on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  // Firefox on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  // Safari on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 2560, height: 1440 },
  { width: 1280, height: 720 },
];

const LANGUAGES = [
  ['ar-SA', 'ar', 'en-US', 'en'],
  ['ar-EG', 'ar', 'en-US', 'en'],
  ['ar-AE', 'ar', 'en-GB', 'en'],
  ['en-US', 'en'],
  ['en-GB', 'en', 'ar'],
];

const HARDWARE = [
  { cores: 4, memory: 4 },
  { cores: 8, memory: 8 },
  { cores: 6, memory: 8 },
  { cores: 12, memory: 16 },
  { cores: 16, memory: 32 },
];

let uaIndex = 0;

/** Get next User-Agent in round-robin */
export function getNextUA(): string {
  const ua = UA_POOL[uaIndex % UA_POOL.length]!;
  uaIndex = (uaIndex + 1) % UA_POOL.length;
  return ua;
}

/** Get a random fingerprint configuration */
export function getRandomFingerprint() {
  const ua      = UA_POOL[Math.floor(Math.random() * UA_POOL.length)]!;
  const vp      = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)]!;
  const langs   = LANGUAGES[Math.floor(Math.random() * LANGUAGES.length)]!;
  const hw      = HARDWARE[Math.floor(Math.random() * HARDWARE.length)]!;
  const isChrome = ua.includes('Chrome') && !ua.includes('Edg');
  const chromeVer = /Chrome\/([\d]+)/.exec(ua)?.[1] ?? '124';
  return { ua, vp, langs, hw, isChrome, chromeVer };
}

/** Build a stealth script with randomized fingerprint */
export function buildStealthScript(fp: ReturnType<typeof getRandomFingerprint>): string {
  const { langs, hw, isChrome, chromeVer } = fp;
  return `(function(){
  try {
    // 1. Hide webdriver
    Object.defineProperty(navigator,'webdriver',{get:()=>undefined,configurable:true});

    // 2. Chrome object (only for Chrome UA)
    ${isChrome ? `
    if(!window.chrome){window.chrome={};}
    const _N=function(){};
    const _E={addListener:_N,removeListener:_N,hasListener:()=>false,dispatch:_N};
    if(!window.chrome.runtime)window.chrome.runtime={
      id:undefined,connect:()=>({postMessage:_N,disconnect:_N,onMessage:_E,onDisconnect:_E}),
      sendMessage:_N,getManifest:()=>({}),getURL:function(p){return p;},
      onMessage:_E,onConnect:_E,onInstalled:_E,onStartup:_E
    };
    if(!window.chrome.app)window.chrome.app={isInstalled:false};
    if(!window.chrome.loadTimes)window.chrome.loadTimes=function(){return{};};
    if(!window.chrome.csi)window.chrome.csi=function(){return{};};
    ` : ''}

    // 3. Languages
    Object.defineProperty(navigator,'languages',{get:()=>${JSON.stringify(langs)},configurable:true});

    // 4. Hardware concurrency & memory
    Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>${hw.cores},configurable:true});
    try{if('deviceMemory' in navigator)Object.defineProperty(navigator,'deviceMemory',{get:()=>${hw.memory},configurable:true});}catch(e){}

    // 5. Hide Electron signals
    try{Object.defineProperty(window,'require',{value:undefined,configurable:true});}catch(e){}
    try{Object.defineProperty(window,'__electronApi',{value:undefined,configurable:true});}catch(e){}
    try{Object.defineProperty(window,'module',{value:undefined,configurable:true});}catch(e){}
    try{Object.defineProperty(window,'process',{value:undefined,configurable:true});}catch(e){}

    // 6. Plugins (Chrome has PDF viewer)
    try {
      const pdfMime={type:'application/pdf',suffixes:'pdf',description:'Portable Document Format'};
      const pdfPlugin={name:'PDF Viewer',description:'Portable Document Format',filename:'internal-pdf-viewer',length:1,
        item:function(i){return i===0?pdfMime:null;},namedItem:function(n){return n==='application/pdf'?pdfMime:null;}};
      pdfMime.enabledPlugin=pdfPlugin;
      Object.defineProperty(navigator,'plugins',{get:function(){
        const arr=Object.create(PluginArray.prototype);arr[0]=pdfPlugin;arr.length=1;
        arr.item=function(i){return i===0?pdfPlugin:null;};
        arr.namedItem=function(n){return n==='PDF Viewer'?pdfPlugin:null;};
        arr.refresh=function(){};return arr;
      },configurable:true});
    }catch(e){}

    // 7. userAgentData (Chrome 90+)
    if(navigator.userAgentData){
      Object.defineProperty(navigator,'userAgentData',{get:()=>({
        brands:[
          {brand:'Not-A.Brand',version:'99'},
          {brand:'Chromium',version:'${chromeVer}'},
          {brand:'Google Chrome',version:'${chromeVer}'}
        ],
        mobile:false,platform:'Windows',
        getHighEntropyValues:function(hints){
          return Promise.resolve({
            brands:[{brand:'Google Chrome',version:'${chromeVer}.0.0.0'}],
            mobile:false,platform:'Windows',platformVersion:'10.0.0',
            architecture:'x86',bitness:'64',model:'',uaFullVersion:'${chromeVer}.0.0.0'
          });
        }
      }),configurable:true});
    }

    // 8. Notification permission (not headless)
    try{
      const orig=window.Notification;
      if(orig && orig.permission==='default'){
        Object.defineProperty(window,'Notification',{
          get:()=>Object.assign(orig,{permission:'default'}),configurable:true
        });
      }
    }catch(e){}

  }catch(e){/* silent */}
})();`;
}

// ─── Auto Retry ───────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts?: number;      // default: 3
  baseDelayMs?: number;      // default: 1000ms
  maxDelayMs?:  number;      // default: 8000ms
  onRetry?:     (attempt: number, error: Error) => void;
}

/**
 * Retry an async function with exponential backoff.
 * Each failure waits 2× longer than the previous.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 8000, onRetry } = opts;

  let lastError: Error = new Error('unknown');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      if (attempt === maxAttempts) break;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      log.warn(`Attempt ${attempt}/${maxAttempts} failed: ${lastError.message} — retrying in ${delay}ms`);
      onRetry?.(attempt, lastError);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/** Delay with random jitter to avoid detection patterns */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs) + minMs);
  return new Promise((r) => setTimeout(r, ms));
}
