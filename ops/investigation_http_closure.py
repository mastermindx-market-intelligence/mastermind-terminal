"""Optional factual Terminal-owner HTTP generation observation.

No CLI/OPEN/credentials/activation. Only the incumbent terminal-build attempt
calls this producer. Import does no IO. NativeAPI/installer reads remain actual
owner effects and need their original grants; source code is not such a grant.
This local Node/Next owner facet NEVER qualifies Macro Options HTTP, other
hosts/realms, direct RPC, old operations, or global ingress/drain.
"""
from __future__ import annotations
import ast
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys

DRIVER = Path('/opt/macro/app/deploy/reconcile-caddy-autosave.py')
DRIVER_SHA256 = '15b179357f63d9ea6201a75d68e1fc76f69975e12a2c650cec7ba3b13f7eb877'
PROC = Path('/proc')
CGROUP = Path('/sys/fs/cgroup')
HOST = 'ubuntu-s-mastermindx'
MAX_PROCESSES = 8192
PROFILES = {
    'production': ('terminal', '/opt/terminal/terminal', '/opt/terminal/terminal', 3000),
    'beta': ('terminal-beta', '/opt/terminal/beta/terminal', '/var/lib/mastermind-terminal-beta/host', 3001),
}
SHA = re.compile(r'[0-9a-f]{40}\Z')
DIGEST = re.compile(r'[0-9a-f]{64}\Z')
TOKEN = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z')

class Unavailable(ValueError):
    """Bounded reason only; never serialize a caught exception or owner bytes."""

def _fail(code):
    raise Unavailable(code)

def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()

def _hash(value):
    return hashlib.sha256(_canonical(value)).hexdigest()

def _read(path, limit=131072):
    fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        chunks=[]; total=0
        while total<=limit:
            block=os.read(fd,min(65536,limit+1-total))
            if not block: break
            chunks.append(block); total+=len(block)
        data=b''.join(chunks)
        after = os.fstat(fd)
        identity = lambda s: (s.st_dev,s.st_ino,s.st_uid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        if identity(before) != identity(after) or len(data) > limit:
            _fail('file_snapshot_unstable_or_oversized')
        return data
    finally:
        os.close(fd)

def _git(repo, *args):
    env = dict(os.environ, GIT_NO_LAZY_FETCH='1', GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0')
    p = subprocess.run(['git','-C',str(repo),*args], env=env, capture_output=True, timeout=30)
    if p.returncode or len(p.stdout)>2*1024*1024:
        _fail('owner_source_unavailable')
    return p.stdout

def _safe_driver():
    # Same source-qualified incumbent import used by p12-caddy-10670-readiness.
    # No alternative HTTP reader or source-hash restamping is supplied.
    if hashlib.sha256(_read(DRIVER, 1048576)).hexdigest() != DRIVER_SHA256:
        _fail('native_reader_source_mismatch')
    code=_read(DRIVER,1048576)
    if hashlib.sha256(code).hexdigest()!=DRIVER_SHA256: _fail('native_reader_source_mismatch')
    old=sys.dont_write_bytecode; old_path=list(sys.path)
    sys.dont_write_bytecode=True
    try:
        sys.path.insert(0,str(DRIVER.parent))
        module=importlib.util.module_from_spec(importlib.util.spec_from_file_location('_investigation_qualified_caddy',DRIVER))
        # Execute the exact checked bytes, not a subsequently reopened file.
        exec(compile(code,str(DRIVER),'exec'),module.__dict__)
        module.require_autosave_mode()
        return module.NativeAPI()
    finally:
        sys.path[:]=old_path; sys.dont_write_bytecode=old

def _proxy_projection(config):
    """All static proxy outcomes, regardless of secret/header match conditions.

    Only structural public host/path/dial fields and ordinal positions survive.
    Raw container keys are not serialized. Header values, raw
    config, credentials and digests of those secret-bearing buffers do not.
    """
    if type(config) is not dict:
        _fail('proxy_shape_invalid')
    servers=config.get('apps',{}).get('http',{}).get('servers')
    if type(servers) is not dict or not servers:
        _fail('proxy_http_inventory_missing')
    routes=[]; count=0
    def walk(node, trail, hosts=(), paths=(), depth=0):
        nonlocal count
        count+=1
        if depth>64 or count>30000: _fail('proxy_inventory_oversized')
        if isinstance(node,list):
            for i,item in enumerate(node): walk(item,trail+('/'+str(i)),hosts,paths,depth+1)
        elif isinstance(node,dict):
            if 'dynamic_upstreams' in node: _fail('dynamic_proxy_inventory_unsupported')
            match=node.get('match',[])
            if type(match) is not list: _fail('proxy_match_shape_invalid')
            local_hosts=list(hosts); local_paths=list(paths)
            for group in match:
                if type(group) is not dict: _fail('proxy_match_shape_invalid')
                for field,target in [('host',local_hosts),('path',local_paths)]:
                    values=group.get(field,[])
                    if type(values) is not list or any(type(x) is not str or len(x)>512 or any(c in x for c in '\r\n\x00?#') for x in values):
                        _fail('proxy_public_selector_unsupported')
                    target.extend(values)
            if node.get('handler')=='reverse_proxy':
                upstreams=node.get('upstreams')
                if type(upstreams) is not list or not upstreams: _fail('proxy_upstreams_incomplete')
                for upstream in upstreams:
                    if type(upstream) is not dict or set(upstream)!={'dial'} or type(upstream['dial']) is not str:
                        _fail('proxy_upstream_unsupported')
                    dial=upstream['dial']
                    m=re.fullmatch(r'(127\.0\.0\.1|localhost|\[::1\]):([1-9][0-9]{0,4})',dial)
                    if not m or int(m[2])>65535: _fail('cross_host_or_dynamic_upstream_unqualified')
                    routes.append({'route':len(routes),'hosts':sorted(set(local_hosts)), 'paths':sorted(set(local_paths)),
                                   'host':'127.0.0.1' if m[1]=='localhost' else m[1], 'port':int(m[2])})
            # Include every branch, including errors; no route-selection optimism.
            for key,value in node.items():
                if key not in {'match','headers','upstreams'} and isinstance(value,(dict,list)):
                    walk(value,trail+'/'+key,tuple(local_hosts),tuple(local_paths),depth+1)
    walk(servers,'http/servers')
    if not routes: _fail('proxy_inventory_empty')
    return routes

class TerminalHttpOwner:
    """Actual fixed owner reads; no snapshot/readyJSON constructor entrance.

    The installer supplies its PRIVATE attempt's canonical repo/target SHA.
    Tests replace IO methods, never invoke this against host/proc/NativeAPI.
    """
    def __init__(self, repo, source_sha):
        if not SHA.fullmatch(source_sha): _fail('owner_source_identity_invalid')
        self.repo=Path(repo); self.source_sha=source_sha
        source=_git(self.repo,'show',source_sha+':ops/terminal-build.sh').decode()
        # Reuse exact incumbent selected-unit process/environment implementation.
        marker="<<'PY_INVESTIGATION_INSTALL'\n"
        if source.count(marker)!=1: _fail('owner_classifier_source_missing')
        code=source.split(marker,1)[1].split('\nPY_INVESTIGATION_INSTALL',1)[0]
        self.ns={'__name__':'_investigation_http_owner_classifier'}
        exec(compile(code,'<qualified-terminal-owner>','exec'),self.ns)
        self.boot_blobs={p:hashlib.sha256(_git(self.repo,'show',source_sha+':'+p)).hexdigest() for p in (
            'terminal/lib/investigationApiAdmission.ts','terminal/lib/investigationBootAdmission.ts')}
        # Fixed supported labels are bounds, not an exhaustive current inventory.
        for literal in ('PRODUCTION_APP_DEFAULT=/opt/terminal/terminal','BETA_APP_DEFAULT=/opt/terminal/beta/terminal',
                        'BETA_HOST_ENV_DIR=/var/lib/mastermind-terminal-beta/host'):
            if literal not in source: _fail('owner_profile_source_changed')
    def _boot(self):
        value=_read(PROC/'sys/kernel/random/boot_id',128).decode().strip()
        if not re.fullmatch(r'[0-9a-f-]{36}',value): _fail('kernel_boot_identity_invalid')
        return value
    def _pid(self,pid):
        # Only ENOENT with stable same-host boot/current snapshots proves absence.
        try: raw=_read(PROC/str(pid)/'stat',4096).decode()
        except FileNotFoundError: return None
        tail=raw.rpartition(')')[2].split()
        if len(tail)<20 or not tail[19].isdigit(): _fail('process_identity_unavailable')
        return tail[19]
    def _nodes(self):
        names=sorted(p.name for p in PROC.iterdir() if p.name.isdecimal())
        if len(names)>MAX_PROCESSES: _fail('process_inventory_oversized')
        rows=[]
        for name in names:
            # A vanished/denied member makes this sample partial, never empty.
            try:
                exe=os.readlink(PROC/name/'exe')
            except FileNotFoundError:
                # Linux kernel threads have no userspace executable. Only the
                # actual stable PF_KTHREAD stat flag may exclude them; a
                # vanished/zombie/denied user process makes this sample partial.
                raw=_read(PROC/name/'stat',4096).decode()
                fields=raw.rpartition(')')[2].split()
                if len(fields)<20 or not fields[6].isdigit() or not int(fields[6]) & 0x00200000:
                    _fail('process_inventory_partial')
                first=fields[19]
                if not first.isdecimal() or self._pid(int(name))!=first: _fail('process_inventory_changed')
                continue
            if Path(exe).name in ('node','nodejs'):
                start=self._pid(int(name))
                if start is None: _fail('process_inventory_changed')
                if os.readlink(PROC/name/'ns/net')!=os.readlink(PROC/'self/ns/net'):
                    _fail('node_network_namespace_unqualified')
                rows.append({'pid':int(name),'start_ticks':start})
        return sorted(rows,key=lambda r:r['pid'])
    def _group(self,path):
        if not path.startswith('/') or '..' in Path(path).parts: _fail('cgroup_scope_invalid')
        root=CGROUP/path.lstrip('/'); found=set(); dirs=[root]
        while dirs:
            here=dirs.pop()
            if here.is_symlink(): _fail('cgroup_scope_invalid')
            values=_read(here/'cgroup.procs',65536).decode().split()
            if any(not v.isdecimal() for v in values): _fail('cgroup_inventory_invalid')
            found.update(map(int,values))
            children=list(here.iterdir())
            if any(p.is_symlink() for p in children): _fail('cgroup_scope_invalid')
            dirs.extend(p for p in children if p.is_dir())
            if len(found)>128 or len(dirs)>128: _fail('cgroup_inventory_oversized')
        return found
    def _unit(self,profile, require_closed):
        unit,app,env_dir,port=PROFILES[profile]
        sha=_read(Path(app)/'.deployment-id',128).decode().strip()
        build=_read(Path(app)/'.next/BUILD_ID',128).decode().strip()
        if not SHA.fullmatch(sha) or not TOKEN.fullmatch(build): _fail('runtime_generation_invalid')
        n=self.ns
        if require_closed: n['classify_environment_topology'](profile,unit,app,env_dir)
        n['classify_launch_wrapper'](profile,unit,str(self.repo),sha,app)
        rows=n['classify_serving_processes'](unit,app,require_closed=require_closed)
        if type(rows) is not dict or set(rows)!={'cgroup','processes'}: _fail('owner_snapshot_source_unsupported')
        if self._group(rows['cgroup'])!={r['pid'] for r in rows['processes']}:
            _fail('partial_or_detached_unit_inventory')
        invocation=n['unit_property'](unit,'InvocationID')
        if not re.fullmatch(r'[0-9a-f]{32}',invocation): _fail('service_generation_invalid')
        for row in rows['processes']:
            row['node_executable']=Path(os.readlink(PROC/str(row['pid'])/'exe')).name in ('node','nodejs')
        contract=True
        for path,digest in self.boot_blobs.items():
            try: same=hashlib.sha256(_git(self.repo,'show',sha+':'+path)).hexdigest()==digest
            except Unavailable: same=False
            contract=contract and same
        if require_closed and not contract: _fail('runtime_boot_contract_unqualified')
        return {'unit':unit,'source_sha':sha,'build_id':build,'invocation_id':invocation,
                'cgroup':rows['cgroup'],'processes':rows['processes'],'boot_contract':contract,'port':port}
    def _sockets(self,nodes):
        listeners={}
        for filename,version in [('net/tcp',4),('net/tcp6',6)]:
            lines=_read(PROC/filename,2*1024*1024).decode().splitlines()[1:]
            for line in lines:
                fields=line.split()
                if len(fields)<10: _fail('listener_inventory_invalid')
                if fields[3]!='0A': continue
                host,port=fields[1].split(':'); data=bytes.fromhex(host)
                if version==4: data=data[::-1]
                else: data=b''.join(data[i:i+4][::-1] for i in range(0,16,4))
                listeners[fields[9]]=(str(ipaddress.ip_address(data)),int(port,16))
        unix={line.split()[6] for line in _read(PROC/'net/unix',2*1024*1024).decode().splitlines()[1:]
              if len(line.split())>=7 and line.split()[3]=='00010000'}
        result=[]
        for row in nodes:
            fds=list((PROC/str(row['pid'])/'fd').iterdir())
            if len(fds)>4096: _fail('listener_inventory_oversized')
            for fd in fds:
                link=os.readlink(fd); m=re.fullmatch(r'socket:\[([0-9]+)\]',link)
                if not m: continue
                if m[1] in unix: _fail('unix_http_ingress_unsupported')
                if m[1] in listeners:
                    address,port=listeners[m[1]]
                    result.append({**row,'address':address,'port':port,'inode':m[1]})
        return sorted(result,key=lambda r:(r['pid'],r['port'],r['inode']))
    def snapshot(self, require_closed=False):
        if socket.gethostname()!=HOST or os.geteuid()!=0: _fail('owner_host_principal_mismatch')
        boot=self._boot(); api=_safe_driver(); config,etag=api.read(); projection=_proxy_projection(config)
        # Whole actual Node process inventory plus complete unit groups/listeners,
        # not merely the two supported profile labels or a caller's empty list.
        nodes=self._nodes(); units=[self._unit(p,require_closed) for p in PROFILES]
        members={r['pid']:r['start_ticks'] for u in units for r in u['processes'] if r['node_executable']}
        if not nodes or {r['pid']:r['start_ticks'] for r in nodes}!=members: _fail('unknown_node_ingress')
        sockets=self._sockets(nodes)
        if not sockets: _fail('http_listener_inventory_empty')
        for row in sockets:
            unit=next((u for u in units if row['pid'] in {p['pid'] for p in u['processes']}),None)
            if unit is None or row['port']!=unit['port']: _fail('hidden_direct_http_ingress')
        for unit in units:
            if not any(s['pid'] in {p['pid'] for p in unit['processes']} for s in sockets): _fail('unit_listener_missing')
        if hashlib.sha256(_read(DRIVER,1048576)).hexdigest()!=DRIVER_SHA256: _fail('native_reader_source_changed')
        config2,etag2=api.read()
        if etag!=etag2 or projection!=_proxy_projection(config2) or self._nodes()!=nodes or self._boot()!=boot:
            _fail('current_http_set_changed')
        for unit in units:
            again=self._unit(next(p for p,v in PROFILES.items() if v[0]==unit['unit']),require_closed)
            if again!=unit: _fail('service_generation_changed')
        # No raw headers/config/environment/cmdline or their hashes are retained.
        return {'schema':'terminal.http_observation.v1','owner_source_sha':self.source_sha,'host':HOST,'boot_id':boot,
                'proxy':{'reader_sha256':DRIVER_SHA256,'etag':etag,'projection':projection},
                'units':units,'nodes':nodes,'listeners':sockets,
                'scope':'local-terminal-node-owner','global_cutover_qualified':False,'macro_options_http':'unqualified'}

def capture_before(repo,source_sha):
    return TerminalHttpOwner(repo,source_sha).snapshot(require_closed=False)

def capture_after(repo,source_sha,before,expected_sha,expected_build):
    _validate_snapshot(before,source_sha)
    owner=TerminalHttpOwner(repo,source_sha)
    current=owner.snapshot(require_closed=True)
    old={str(p['pid']):owner._pid(p['pid']) for u in before.get('units',[]) for p in u.get('processes',[])}
    result=assess_exit(before,current,old,source_sha,expected_sha,expected_build)
    if owner.snapshot(require_closed=True)!=current: _fail('current_http_set_changed')
    final_states={pid:owner._pid(int(pid)) for pid in old}
    assess_exit(before,current,final_states,source_sha,expected_sha,expected_build)
    return result

def _validate_snapshot(sample,source_sha):
    if type(sample)is not dict: _fail("prior_owned_capture_missing")
    required={'schema','owner_source_sha','host','boot_id','proxy','units','nodes','listeners','scope','global_cutover_qualified','macro_options_http'}
    if set(sample)!=required or sample['schema']!='terminal.http_observation.v1' or sample['owner_source_sha']!=source_sha:
        _fail('owned_snapshot_source_mismatch')
    if sample['host']!=HOST or sample['scope']!='local-terminal-node-owner' or sample['global_cutover_qualified'] is not False or sample['macro_options_http']!='unqualified':
        _fail('unknown_cross_owner_scope')
    if not re.fullmatch(r'[0-9a-f-]{36}',sample['boot_id']): _fail('kernel_boot_identity_invalid')
    if not all(type(sample[k]) is list and sample[k] for k in ('units','nodes','listeners')): _fail('partial_http_inventory')
    if len(sample['units'])!=len(PROFILES) or {u.get('unit') for u in sample['units'] if type(u)is dict}!={v[0] for v in PROFILES.values()}:
        _fail('partial_http_inventory')
    proxy=sample['proxy']
    if type(proxy)is not dict or set(proxy)!={'reader_sha256','etag','projection'} or proxy['reader_sha256']!=DRIVER_SHA256:
        _fail('proxy_source_invalid')
    if type(proxy['etag'])is not str or not re.fullmatch(r'"[^"\r\n]{1,256}"',proxy['etag']) or type(proxy['projection'])is not list or not proxy['projection']:
        _fail('proxy_inventory_incomplete')
    for route in proxy['projection']:
        if type(route)is not dict or set(route)!={'route','hosts','paths','host','port'} or type(route['route'])is not int or route['route']<0 or route['host']not in ('127.0.0.1','[::1]'):
            _fail('proxy_projection_invalid')
        if type(route['port'])is not int or not 0<route['port']<65536: _fail('proxy_projection_invalid')
    pids={}; nodes={}; ports={}
    for u in sample['units']:
        if set(u)!={'unit','source_sha','build_id','invocation_id','cgroup','processes','boot_contract','port'}:
            _fail('unit_observation_invalid')
        expected_port=next(v[3] for v in PROFILES.values() if v[0]==u['unit'])
        if u['port']!=expected_port or not SHA.fullmatch(u['source_sha']) or not TOKEN.fullmatch(u['build_id']) or not re.fullmatch(r'[0-9a-f]{32}',u['invocation_id']):
            _fail('service_generation_invalid')
        if type(u['processes'])is not list or not u['processes'] or type(u['boot_contract'])is not bool: _fail('partial_http_inventory')
        if type(u['cgroup'])is not str or not u['cgroup'].startswith('/') or '..'in Path(u['cgroup']).parts: _fail('cgroup_scope_invalid')
        for row in u['processes']:
            if type(row)is not dict or set(row)!={'pid','start_ticks','role','initial_closed','node_executable'}: _fail('process_observation_invalid')
            pid=row['pid']; ticks=row['start_ticks']
            if type(pid)is not int or pid<=0 or pid in pids or type(ticks)is not str or not ticks.isdecimal() or int(ticks)<=0 or type(row['initial_closed'])is not bool or type(row['node_executable'])is not bool:
                _fail('process_identity_invalid')
            if type(row['role'])is not str or not re.fullmatch('[a-z_]{1,32}',row['role']): _fail('process_observation_invalid')
            pids[pid]=ticks; ports[pid]=u['port']
            if row['node_executable']: nodes[pid]=ticks
    if not nodes or any(type(r)is not dict or set(r)!={'pid','start_ticks'} for r in sample['nodes']): _fail('partial_http_inventory')
    if len(sample['nodes'])!=len(nodes) or {r['pid']:r['start_ticks'] for r in sample['nodes']}!=nodes: _fail('unknown_or_partial_node_inventory')
    for row in sample['listeners']:
        if type(row)is not dict or set(row)!={'pid','start_ticks','address','port','inode'}: _fail('listener_inventory_invalid')
        if row['pid']not in nodes or row['start_ticks']!=nodes[row['pid']] or row['port']!=ports[row['pid']]: _fail('hidden_direct_http_ingress')
        try: ipaddress.ip_address(row['address'])
        except ValueError: _fail('listener_inventory_invalid')
        if type(row['inode'])is not str or not row['inode'].isdecimal(): _fail('listener_inventory_invalid')
    if any(not any(r['pid']in {p['pid'] for p in u['processes']} for r in sample['listeners'])for u in sample['units']): _fail('unit_listener_missing')

def _prior_process_expectations(before,current):
    """Exit for every potentially-admitting prior generation. The supported
    beta transaction may leave production untouched ONLY when the complete
    private before/current production unit and listeners are identical and its
    actual source-bound negative boot floor plus every birth environment were
    CLOSED. No environment/health-only exception, beta PID retention, or generic
    live-PID allowance. Caller uses this only after both snapshots validate.
    """
    expected={str(p['pid']):None for u in before['units'] for p in u['processes']}
    old=next(u for u in before['units'] if u['unit']=='terminal')
    new=next(u for u in current['units'] if u['unit']=='terminal')
    if old==new and old['boot_contract'] is True and all(p['initial_closed'] is True for p in old['processes']):
        pids={p['pid'] for p in old['processes']}
        old_listeners=[r for r in before['listeners'] if r['pid'] in pids]
        new_listeners=[r for r in current['listeners'] if r['pid'] in pids]
        if old_listeners==new_listeners:
            expected.update({str(p['pid']):p['start_ticks'] for p in old['processes']})
    return expected

def assess_exit(before,current,old_pid_states,source_sha,expected_sha,expected_build):
    """Internal comparison of actual PRIVATE owner observations, not a readyJSON API."""
    if type(before) is not dict or type(current) is not dict: _fail('prior_owned_capture_missing')
    for sample in (before,current): _validate_snapshot(sample,source_sha)
    if before['boot_id']!=current['boot_id'] or before['proxy']!=current['proxy']: _fail('proxy_or_kernel_generation_changed')
    prior={str(r['pid']) for u in before['units'] for r in u['processes']}
    if type(old_pid_states) is not dict or set(old_pid_states)!=prior: _fail('prior_process_observation_partial')
    expected_states=_prior_process_expectations(before,current)
    if old_pid_states!=expected_states: _fail('earlier_process_alive_reused_or_unqualified_retention')
    if not all(u['boot_contract'] is True and all(p['initial_closed'] is True for p in u['processes']) for u in current['units']): _fail('new_generation_not_boot_closed')
    target=next(u for u in current['units'] if u['unit']=='terminal-beta')
    if target['source_sha']!=expected_sha or target['build_id']!=expected_build: _fail('target_source_or_build_changed')
    return {'state':'local_terminal_http_exit_observed','before':before,'after':current,
            'global_cutover_qualified':False,'macro_options_http':'unqualified'}

def observe_current(repo,source_sha,observation):
    if type(observation)is not dict or set(observation)!={'state','before','after','global_cutover_qualified','macro_options_http'} or observation['state']!='local_terminal_http_exit_observed':
        _fail('owned_http_observation_missing')
    if observation['global_cutover_qualified']is not False or observation['macro_options_http']!='unqualified': _fail('unknown_cross_owner_scope')
    _validate_snapshot(observation['before'],source_sha); _validate_snapshot(observation['after'],source_sha)
    owner=TerminalHttpOwner(repo,source_sha); current=owner.snapshot(require_closed=True)
    if current!=observation['after']: _fail('current_http_set_changed')
    states={str(p['pid']):owner._pid(p['pid']) for u in observation['before']['units'] for p in u['processes']}
    target=next(u for u in current['units'] if u['unit']=='terminal-beta')
    assess_exit(observation['before'],current,states,source_sha,source_sha,target['build_id'])
    return {'state':'local_terminal_http_observation_current','current':current,
            'global_cutover_qualified':False,'macro_options_http':'unqualified'}
