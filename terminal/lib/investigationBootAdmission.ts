import "server-only";
import { isMainThread } from "node:worker_threads";
import { openSync, readSync, closeSync, constants } from "node:fs";

export const INVESTIGATION_BOOT_ENV_LIMIT = 128 * 1024;
const KEY = Buffer.from("INVESTIGATION_API_ADMISSION");

/** Linux execve environment only; ordinary later putenv changes are absent.
 * This is NOT tamperproof or a runtime attestation: trusted native code can
 * alter environment memory/prctl boundaries. No raw environment leaves here.
 * https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html
 */
export function parseInvestigationBootEnvironment(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > INVESTIGATION_BOOT_ENV_LIMIT) return false;
  let start=0, matches=0, allowed=false;
  for(let end=0;end<=bytes.length;end++) {
    if(end<bytes.length && bytes[end]!==0) continue;
    if(end===start) {
      if(end===bytes.length && end>0 && bytes[end-1]===0) break;
      return false;
    }
    let equals=start;
    while(equals<end && bytes[equals]!==61) equals++;
    if(equals===start || equals===end) return false;
    for(let i=start;i<equals;i++) {
      const c=bytes[i];
      if(!((c>=65&&c<=90)||(c>=97&&c<=122)||c===95||(i>start&&c>=48&&c<=57))) return false;
    }
    if(equals-start===KEY.length && KEY.every((c,i)=>bytes[start+i]===c)) {
      matches++;
      allowed=end-equals===5 && bytes[equals+1]===111 && bytes[equals+2]===112 && bytes[equals+3]===101 && bytes[equals+4]===110;
    }
    start=end+1;
  }
  return matches===1 && allowed;
}

/** Fixed, bounded own-process read. No fallback, credential, arbitrary path,
 * raw error, logger, digest, or caller-supplied admission observation.
 * Import itself performs no IO. Unsupported platform/read failures fail CLOSED.
 */
export function readInvestigationBootAdmission(): boolean {
  if(process.platform!=="linux" || !isMainThread) return false;
  const bytes=Buffer.alloc(INVESTIGATION_BOOT_ENV_LIMIT+1);
  let fd: number|undefined, total=0, eof=false, allowed=false;
  try {
    fd=openSync("/proc/self/environ",constants.O_RDONLY);
    while(total<bytes.length) {
      const count=readSync(fd,bytes,total,Math.min(4096,bytes.length-total),null);
      if(!Number.isSafeInteger(count)||count<0||count>Math.min(4096,bytes.length-total)) break;
      if(count===0) {eof=true;break;}
      total+=count;
    }
    allowed=eof && parseInvestigationBootEnvironment(bytes.subarray(0,total));
  } catch {allowed=false;}
  finally {
    if(fd!==undefined)try{closeSync(fd);}catch{allowed=false;}
    bytes.fill(0);
  }
  return allowed;
}

// One negative bit in the existing Node execution REALM, not an inventory
// or positive attestation. Two route bundles in one realm share this symbol.
// Other VM realms are not attested; worker threads refuse the boot read.
// This never proves whole-process, all-ingress cutoff, or external drain.
// Any existing property denies; no value can supply readiness. No reset API.
const DENIED = Symbol.for("mastermind.investigation.admission.observed-closed.v1");
export function hasObservedInvestigationClosure(): boolean {
  return Object.getOwnPropertyDescriptor(globalThis,DENIED)!==undefined;
}
export function observeInvestigationClosure(): void {
  if(!hasObservedInvestigationClosure()) Object.defineProperty(globalThis,DENIED,{
    value:true,writable:false,configurable:false,enumerable:false,
  });
}
