"""Inspect/stop only freshly verified disposable QA processes. Never delete data."""
import argparse
import json
import os
import signal
import subprocess
import time
import runtime


def verified_pid(pid,fragment,cwd):
    actual=subprocess.check_output(['ps','-p',str(pid),'-o','uid=,command='],text=True).strip()
    if int(actual.split()[0])!=os.getuid() or fragment not in actual:raise RuntimeError('Test process ownership mismatch')
    directory=subprocess.check_output(['/usr/sbin/lsof','-a','-p',str(pid),'-d','cwd','-Fn'],text=True)
    if '\nn'+str(cwd)+'\n' not in directory:raise RuntimeError('Test working directory mismatch')


def main(stop):
    cfg=runtime.load();server=json.loads((runtime.PRIVATE/'server.json').read_text());pid=server['pid']
    verified_pid(pid,str(runtime.WORKSPACE/'local/omar/staff-runtime/runtime.py')+' serve',runtime.WORKSPACE)
    listeners=subprocess.check_output(['/usr/sbin/lsof','-nP','-iTCP:54443','-sTCP:LISTEN','-t'],text=True).split()
    if set(listeners)!={str(pid)}:raise RuntimeError('HTTPS listener does not belong only to the test server')
    pgpid=int((runtime.PRIVATE/'data/postmaster.pid').read_text().splitlines()[0])
    verified_pid(pgpid,'-D '+cfg['data'],cfg['data'])
    print('Verified disposable HTTPS PID',pid,'and private PostgreSQL PID',pgpid)
    if not stop:return
    os.kill(pid,signal.SIGINT)
    for _ in range(100):
        result=subprocess.run(['/usr/sbin/lsof','-nP','-iTCP:54443','-sTCP:LISTEN','-t'],capture_output=True,text=True)
        if result.returncode==1 and not result.stdout and not result.stderr:break
        time.sleep(.1)
    else:raise RuntimeError('Test server has not released its port; no other process will be stopped')
    subprocess.run([str(runtime.PG/'pg_ctl'),'-D',cfg['data'],'-m','fast','-w','stop'],env=runtime.clean_env(),check=True)
    print('Stopped only verified disposable QA services; private artifacts retained.')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['status','stop']);args=parser.parse_args();main(args.action=='stop')
